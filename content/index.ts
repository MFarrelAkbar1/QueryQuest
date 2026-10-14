import { z } from "zod";
import { DatasetSchema, TierSchema, type Dataset, type Tier } from "./schema";
import { datasetInputs, tierInputs } from "./tiers";

export type Content = { tiers: Tier[]; datasets: Map<string, Dataset> };

/** Parses all content and checks cross-references. Throws with a readable path on error. */
export function parseContent(rawTiers: unknown = tierInputs, rawDatasets: unknown = datasetInputs): Content {
  const datasets = z.array(DatasetSchema).parse(rawDatasets);
  const tiers = z
    .array(TierSchema)
    .superRefine((all, ctx) => {
      const seen = new Set<string>();
      const datasetIds = new Set(datasets.map((d) => d.id));
      let joinChapters = 0;
      all.forEach((tier, ti) => {
        if (tier.number !== ti + 1 && tier.status === "available") {
          ctx.addIssue({ code: "custom", path: [ti, "number"], message: "available tiers must be numbered in order" });
        }
        tier.chapters.forEach((chapter, ci) => {
          if (chapter.achievement === "join_master") joinChapters++;
          for (const id of [chapter.id, ...chapter.challenges.map((c) => c.id)]) {
            if (seen.has(id)) ctx.addIssue({ code: "custom", path: [ti, "chapters", ci], message: `duplicate id ${id}` });
            seen.add(id);
          }
          chapter.challenges.forEach((challenge, xi) => {
            if (!datasetIds.has(challenge.datasetId)) {
              ctx.addIssue({
                code: "custom",
                path: [ti, "chapters", ci, "challenges", xi, "datasetId"],
                message: `unknown dataset ${challenge.datasetId}`,
              });
            }
          });
        });
      });
      if (joinChapters > 1) ctx.addIssue({ code: "custom", path: [], message: "only one chapter can award join_master" });
    })
    .parse(rawTiers);
  return { tiers, datasets: new Map(datasets.map((d) => [d.id, d])) };
}

export const content: Content = parseContent();
