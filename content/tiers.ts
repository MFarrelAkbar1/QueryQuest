import { arcade } from "./datasets/arcade";
import type { DatasetInput, TierInput } from "./schema";
import { chapter1 as t1c1 } from "./tier-1/chapter-1";
import { chapter2 as t1c2 } from "./tier-1/chapter-2";
import { chapter3 as t1c3 } from "./tier-1/chapter-3";

/** Raw (unvalidated) content. Import `content` from ./index for the parsed version. */
export const datasetInputs: DatasetInput[] = [arcade];

export const tierInputs: TierInput[] = [
  {
    id: "tier-1",
    number: 1,
    title: "SQL Beginner",
    description: "Read and filter data: SELECT, WHERE, comparisons, AND/OR/NOT, ORDER BY, LIMIT and DISTINCT.",
    bonusXp: 150,
    status: "available",
    chapters: [t1c1, t1c2, t1c3],
  },
  {
    id: "tier-4",
    number: 4,
    title: "SQL Analyst",
    description: "Subqueries, common table expressions and window functions.",
    bonusXp: 0,
    status: "coming-soon",
    chapters: [],
  },
  {
    id: "tier-5",
    number: 5,
    title: "SQL Architect",
    description: "Transactions, EXPLAIN and schema design.",
    bonusXp: 0,
    status: "coming-soon",
    chapters: [],
  },
];
