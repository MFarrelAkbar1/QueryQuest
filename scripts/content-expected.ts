/**
 * Authoring helper: runs challenges' reference solutions through the real SQL runner and
 * prints the `expected` block to paste into the content file. Review the output before
 * pasting. It is the source of truth learners are graded against.
 *
 *   npm run content:expected -- t1-c2-01 [t1-c2-02 ...]   # specific challenges
 *   npm run content:expected -- --all                      # every challenge
 *
 * Needs a running runner (`docker compose up -d`) and RUNNER_URL / RUNNER_SECRET
 * (defaults match docker-compose.yml).
 */
import { DatasetSchema, type ChallengeInput } from "../content/schema";
import { datasetInputs, tierInputs } from "../content/tiers";
import { datasetToSetupSql } from "../src/lib/content/setup-sql";
import { callRunner } from "../src/lib/runner/protocol";

const RUNNER_URL = process.env.RUNNER_URL ?? "http://127.0.0.1:4000";
const RUNNER_SECRET = process.env.RUNNER_SECRET ?? "devonly-runner-secret-not-for-production";

const args = process.argv.slice(2);
const challenges: ChallengeInput[] = tierInputs.flatMap((t) => t.chapters.flatMap((c) => c.challenges));
const selected = args.includes("--all") ? challenges : challenges.filter((c) => args.includes(c.id));
if (selected.length === 0) {
  console.error("Usage: npm run content:expected -- <challenge-id ...> | --all");
  process.exit(1);
}

const datasets = new Map(datasetInputs.map((d) => [d.id, DatasetSchema.parse(d)]));
let failed = false;

for (const challenge of selected) {
  const dataset = datasets.get(challenge.datasetId);
  if (!dataset) throw new Error(`${challenge.id}: unknown dataset ${challenge.datasetId}`);

  const res = await callRunner(RUNNER_URL, RUNNER_SECRET, {
    clientKey: "script:content-expected",
    setupSql: datasetToSetupSql(dataset),
    sql: challenge.solution.sql,
    allowedStatement: challenge.statementType,
    verificationSql: challenge.verificationSql,
  });
  if (!res.ok) {
    console.error(`${challenge.id}: ${res.error.code}: ${res.error.message}`);
    failed = true;
    continue;
  }
  const set = challenge.statementType === "dml" ? res.verification : res.result;
  if (!set || set.truncated) {
    console.error(`${challenge.id}: no result set, or more than 200 rows`);
    failed = true;
    continue;
  }
  const ordered = /\border\s+by\b/i.test(challenge.verificationSql ?? challenge.solution.sql);
  console.log(`// ${challenge.id}`);
  console.log(JSON.stringify({ columns: set.columns, rows: set.rows, ordered }));
}

process.exit(failed ? 1 : 0);
