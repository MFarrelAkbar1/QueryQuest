import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import type { Config } from "./config.js";
import { UserSqlError, type RunnerError } from "./errors.js";
import { errorSummary, type Executor } from "./execute.js";
import { BusyError, RateLimiter, Semaphore } from "./limits.js";

const ExecuteBody = z.object({
  clientKey: z.string().min(1).max(200),
  clientIp: z.string().max(100).optional(),
  setupSql: z.string(),
  sql: z.string(),
  allowedStatement: z.enum(["select", "dml"]),
  verificationSql: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type ExecuteRequest = z.infer<typeof ExecuteBody>;

function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendError(reply: FastifyReply, status: number, error: RunnerError) {
  return reply.status(status).send({ ok: false, error });
}

export function buildApp(config: Config, executor: Executor): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers['x-runner-secret']"] },
    bodyLimit: config.MAX_SETUP_SQL_LENGTH + config.MAX_SQL_LENGTH * 2 + 10_000,
  });
  const userLimiter = new RateLimiter(config.RATE_LIMIT_PER_MINUTE);
  const ipLimiter = new RateLimiter(config.IP_RATE_LIMIT_PER_MINUTE);
  const semaphore = new Semaphore(config.MAX_CONCURRENT, config.MAX_QUEUE);
  const pruneTimer = setInterval(() => {
    userLimiter.prune();
    ipLimiter.prune();
  }, 60_000);
  pruneTimer.unref();
  app.addHook("onClose", async () => clearInterval(pruneTimer));

  // Never leak stack traces or internals, whatever goes wrong.
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return sendError(reply, status, { code: "INVALID_REQUEST", message: "Invalid request." });
    }
    app.log.error({ err: errorSummary(err) }, "unhandled error");
    return sendError(reply, 500, { code: "INTERNAL", message: "The SQL runner hit an internal error." });
  });

  app.get("/health", async (_req, reply) => {
    try {
      await executor.ping();
      return { status: "ok", mysql: "ok" };
    } catch {
      return reply.status(503).send({ status: "degraded", mysql: "unreachable" });
    }
  });

  app.post("/execute", async (req, reply) => {
    if (!secretMatches(req.headers["x-runner-secret"], config.RUNNER_SECRET)) {
      return sendError(reply, 401, { code: "UNAUTHORIZED", message: "Unauthorized." });
    }

    const parsed = ExecuteBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, { code: "INVALID_REQUEST", message: "Invalid request body." });
    }
    const body = parsed.data;
    if (body.setupSql.length > config.MAX_SETUP_SQL_LENGTH) {
      return sendError(reply, 400, { code: "INVALID_REQUEST", message: "setupSql is too long." });
    }
    if (body.sql.length > config.MAX_SQL_LENGTH) {
      return reply.send({
        ok: false,
        error: { code: "SQL_TOO_LONG", message: `Your query is longer than ${config.MAX_SQL_LENGTH} characters.` },
      });
    }

    const waitUser = userLimiter.take(body.clientKey);
    const waitIp = body.clientIp ? ipLimiter.take(body.clientIp) : 0;
    const retryAfterMs = Math.max(waitUser, waitIp);
    if (retryAfterMs > 0) {
      return sendError(reply, 429, {
        code: "RATE_LIMITED",
        message: "Too many queries. Wait a moment and try again.",
        retryAfterMs,
      });
    }

    const timeoutMs = Math.min(body.timeoutMs ?? config.DEFAULT_TIMEOUT_MS, config.MAX_TIMEOUT_MS);
    try {
      const output = await semaphore.run(() =>
        executor.execute({
          setupSql: body.setupSql,
          sql: body.sql,
          allowedStatement: body.allowedStatement,
          verificationSql: body.verificationSql,
          timeoutMs,
        }),
      );
      return { ok: true, ...output };
    } catch (err) {
      if (err instanceof UserSqlError) {
        return reply.send({
          ok: false,
          error: { code: err.code, message: err.message, ...(err.mysqlErrno ? { mysqlErrno: err.mysqlErrno } : {}) },
        });
      }
      if (err instanceof BusyError) {
        return sendError(reply, 429, {
          code: "BUSY",
          message: "The SQL runner is busy. Try again in a moment.",
          retryAfterMs: 1000,
        });
      }
      throw err;
    }
  });

  return app;
}
