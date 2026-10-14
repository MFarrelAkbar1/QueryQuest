import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import type { Config } from "./config.js";
import { Executor, errorSummary } from "./execute.js";

export type RunningRunner = { app: FastifyInstance; executor: Executor; stop: () => Promise<void> };

/** Sweeps orphans left by a previous crash, starts periodic sweeps, then listens. */
export async function startRunner(config: Config): Promise<RunningRunner> {
  const executor = new Executor(config);
  const app = buildApp(config, executor);

  const sweep = async (label: string) => {
    try {
      const swept = await executor.sweepOrphans(config.ORPHAN_MAX_AGE_MS);
      if (swept.length > 0) app.log.warn({ count: swept.length }, `${label}: dropped orphaned temp databases`);
    } catch (err) {
      app.log.error({ err: errorSummary(err) }, `${label}: orphan sweep failed`);
    }
  };

  await sweep("startup");
  const sweepTimer = setInterval(() => void sweep("periodic"), config.SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  await app.listen({ host: config.HOST, port: config.PORT });

  return {
    app,
    executor,
    stop: async () => {
      clearInterval(sweepTimer);
      await app.close();
      await executor.close();
    },
  };
}
