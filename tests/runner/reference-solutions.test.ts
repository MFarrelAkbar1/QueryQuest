/**
 * Layer 2 (part B): every challenge's reference solution, run on real MySQL through the
 * runner, must pass its own validator. Needs `docker compose up -d` (MySQL + runner).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { allChallenges, setupSqlFor, type Challenge } from "@/lib/content";
import { callRunner } from "@/lib/runner/protocol";
import { compareResults } from "@/lib/validation/compare";

const RUNNER_URL = process.env.RUNNER_URL ?? "http://127.0.0.1:4000";
const RUNNER_SECRET = process.env.RUNNER_SECRET ?? "devonly-runner-secret-not-for-production";

async function judge(challenge: Challenge, sql: string) {
  const res = await callRunner(RUNNER_URL, RUNNER_SECRET, {
    // Unique key per call: these tests should not trip the per-user rate limit.
    clientKey: `test:reference:${challenge.id}:${Math.random()}`,
    setupSql: setupSqlFor(challenge),
    sql,
    allowedStatement: challenge.statementType,
    verificationSql: challenge.verificationSql,
  });
  if (!res.ok) return { ran: false as const, error: res.error };
  const actual = challenge.statementType === "dml" ? res.verification : res.result;
  if (!actual) return { ran: false as const, error: { code: "NO_RESULT", message: "no result set" } };
  return { ran: true as const, comparison: compareResults(actual, challenge.expected) };
}

beforeAll(async () => {
  const health = await fetch(new URL("/health", RUNNER_URL)).catch(() => undefined);
  if (!health?.ok) throw new Error(`SQL runner not reachable at ${RUNNER_URL}. Run \`docker compose up -d\` first.`);
});

describe("reference solutions", () => {
  it.each(allChallenges.map(({ challenge }) => [challenge.id, challenge] as const))(
    "%s passes its own validator",
    async (_id, challenge) => {
      const outcome = await judge(challenge, challenge.solution.sql);
      expect(outcome).toEqual({ ran: true, comparison: { pass: true } });
    },
  );
});

describe("the validator actually discriminates", () => {
  const get = (id: string) => allChallenges.find((c) => c.challenge.id === id)!.challenge;

  it("accepts an equivalent but different query", async () => {
    const outcome = await judge(get("t1-c3-02"), "SELECT title, genre FROM games WHERE genre IN ('Strategy', 'Puzzle') ORDER BY id DESC");
    expect(outcome).toEqual({ ran: true, comparison: { pass: true } });
  });

  it("rejects the classic AND/OR precedence mistake", async () => {
    const outcome = await judge(
      get("t1-c3-03"),
      "SELECT title, genre FROM games WHERE genre = 'Racing' OR genre = 'Action' AND NOT platform = 'Mobile'",
    );
    expect(outcome).toMatchObject({ ran: true, comparison: { pass: false, code: "ROW_COUNT" } });
  });

  it("rejects wrong column order and boundary mistakes", async () => {
    expect(await judge(get("t1-c1-03"), "SELECT title, platform, price FROM games")).toMatchObject({
      comparison: { pass: false, code: "COLUMN_NAMES" },
    });
    expect(await judge(get("t1-c2-03"), "SELECT title, release_year FROM games WHERE release_year > 2020")).toMatchObject({
      comparison: { pass: false, code: "ROW_COUNT" },
    });
  });
});
