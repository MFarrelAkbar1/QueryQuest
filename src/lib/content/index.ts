import { content } from "@content/index";
import type { Challenge, Chapter, Dataset, Tier } from "@content/schema";
import { datasetToSetupSql } from "./setup-sql";

export type { Challenge, Chapter, Dataset, Tier };

export type ChallengeContext = {
  challenge: Challenge;
  chapter: Chapter;
  tier: Tier;
  /** Position in the whole course, used for previous/next navigation. */
  index: number;
  previousId?: string;
  nextId?: string;
};

export const tiers: Tier[] = content.tiers;

/** Every challenge in course order (tier → chapter → challenge). */
export const allChallenges: ChallengeContext[] = (() => {
  const flat = tiers.flatMap((tier) =>
    tier.chapters.flatMap((chapter) => chapter.challenges.map((challenge) => ({ challenge, chapter, tier }))),
  );
  return flat.map((entry, index) => ({
    ...entry,
    index,
    previousId: flat[index - 1]?.challenge.id,
    nextId: flat[index + 1]?.challenge.id,
  }));
})();

const byId = new Map(allChallenges.map((c) => [c.challenge.id, c]));

export function getChallengeContext(id: string): ChallengeContext | undefined {
  return byId.get(id);
}

export function getDataset(id: string): Dataset {
  const dataset = content.datasets.get(id);
  if (!dataset) throw new Error(`Unknown dataset ${id}`);
  return dataset;
}

const setupSqlCache = new Map<string, string>();

/** Schema + seed SQL for a challenge's dataset, as sent to the runner. */
export function setupSqlFor(challenge: Challenge): string {
  let sql = setupSqlCache.get(challenge.datasetId);
  if (sql === undefined) {
    sql = datasetToSetupSql(getDataset(challenge.datasetId));
    setupSqlCache.set(challenge.datasetId, sql);
  }
  return sql;
}

/** The chapter whose completion awards Join Master, if it exists yet. */
export const joinChapterId: string | undefined = tiers
  .flatMap((t) => t.chapters)
  .find((c) => c.achievement === "join_master")?.id;
