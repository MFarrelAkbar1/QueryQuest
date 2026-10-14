import { z } from "zod";

/**
 * Schema for all learning content. Every file under /content is parsed with these
 * schemas (at load time and in tests), so a malformed challenge fails fast.
 */

const Identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "lowercase SQL identifier");
const Cell = z.union([z.string(), z.number(), z.null()]);

export const ColumnSchema = z.object({
  name: Identifier,
  /** MySQL column type, e.g. INT, VARCHAR(60), DECIMAL(6,2), DATE. */
  type: z.string().regex(/^[A-Z]+(\(\d+(,\d+)?\))?( UNSIGNED)?$/, "MySQL type such as VARCHAR(60)"),
  primaryKey: z.boolean().default(false),
  nullable: z.boolean().default(false),
  references: z.object({ table: Identifier, column: Identifier }).optional(),
  description: z.string().optional(),
});

export const TableSchema = z
  .object({
    name: Identifier,
    description: z.string().min(1),
    columns: z.array(ColumnSchema).min(1),
    rows: z.array(z.array(Cell)),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, i) => {
      if (row.length !== table.columns.length) {
        ctx.addIssue({ code: "custom", path: ["rows", i], message: `expected ${table.columns.length} values` });
      }
      row.forEach((value, j) => {
        if (value === null && !table.columns[j]?.nullable) {
          ctx.addIssue({ code: "custom", path: ["rows", i, j], message: `${table.columns[j]?.name} is not nullable` });
        }
      });
    });
  });

export const DatasetSchema = z
  .object({
    id: Identifier,
    title: z.string().min(1),
    description: z.string().min(1),
    tables: z.array(TableSchema).min(1),
  })
  .superRefine((dataset, ctx) => {
    const tables = new Map(dataset.tables.map((t) => [t.name, t]));
    dataset.tables.forEach((table, ti) => {
      table.columns.forEach((column, ci) => {
        const ref = column.references;
        if (!ref) return;
        const target = tables.get(ref.table);
        if (!target?.columns.some((c) => c.name === ref.column)) {
          ctx.addIssue({
            code: "custom",
            path: ["tables", ti, "columns", ci, "references"],
            message: `unknown reference ${ref.table}.${ref.column}`,
          });
        }
      });
    });
  });

export const DIFFICULTY_XP = { easy: 10, medium: 20, hard: 30 } as const;

export const ChallengeSchema = z
  .object({
    id: z.string().regex(/^t\d-c\d-\d{2}$/, "id like t1-c2-03"),
    title: z.string().min(1).max(80),
    difficulty: z.enum(["easy", "medium", "hard"]),
    /** What the learner will be able to do afterwards. */
    objective: z.string().min(1),
    /** Short concept explanation (markdown). */
    concept: z.string().min(1),
    /** The task (markdown). */
    problem: z.string().min(1),
    datasetId: Identifier,
    statementType: z.enum(["select", "dml"]),
    starterSql: z.string(),
    hints: z.array(z.string().min(1)).min(1).max(3),
    solution: z.object({ sql: z.string().min(1), explanation: z.string().min(1) }),
    /** For DML challenges: SELECT run after the learner's statement; its result is compared. */
    verificationSql: z.string().min(1).optional(),
    expected: z.object({
      columns: z.array(z.string().min(1)).min(1),
      rows: z.array(z.array(Cell)).max(200),
      /** Compare row order only when the problem asks for a specific order. */
      ordered: z.boolean(),
    }),
    xp: z.number().int().positive().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.statementType === "dml" && !c.verificationSql) {
      ctx.addIssue({ code: "custom", path: ["verificationSql"], message: "DML challenges need a verificationSql" });
    }
    if (c.statementType === "select" && c.verificationSql) {
      ctx.addIssue({ code: "custom", path: ["verificationSql"], message: "only DML challenges use verificationSql" });
    }
    c.expected.rows.forEach((row, i) => {
      if (row.length !== c.expected.columns.length) {
        ctx.addIssue({ code: "custom", path: ["expected", "rows", i], message: "row width differs from columns" });
      }
    });
  })
  .transform((c) => ({ ...c, xp: c.xp ?? DIFFICULTY_XP[c.difficulty] }));

export const ChapterSchema = z.object({
  id: z.string().regex(/^t\d-c\d$/, "id like t1-c2"),
  title: z.string().min(1),
  summary: z.string().min(1),
  bonusXp: z.number().int().nonnegative(),
  /** Finishing this chapter awards an achievement (e.g. the JOIN chapter → join_master). */
  achievement: z.enum(["join_master"]).optional(),
  challenges: z.array(ChallengeSchema).min(3).max(5),
});

export const TierSchema = z
  .object({
    id: z.string().regex(/^tier-\d$/),
    number: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1),
    bonusXp: z.number().int().nonnegative(),
    status: z.enum(["available", "coming-soon"]),
    chapters: z.array(ChapterSchema),
  })
  .superRefine((tier, ctx) => {
    if (tier.status === "coming-soon" && tier.chapters.length > 0) {
      ctx.addIssue({ code: "custom", path: ["chapters"], message: "coming-soon tiers have no content" });
    }
    if (tier.status === "available" && tier.chapters.length === 0) {
      ctx.addIssue({ code: "custom", path: ["chapters"], message: "available tiers need chapters" });
    }
    tier.chapters.forEach((chapter, i) => {
      if (!chapter.id.startsWith(`t${tier.number}-`)) {
        ctx.addIssue({ code: "custom", path: ["chapters", i, "id"], message: `must start with t${tier.number}-` });
      }
      chapter.challenges.forEach((challenge, j) => {
        if (!challenge.id.startsWith(`${chapter.id}-`)) {
          ctx.addIssue({ code: "custom", path: ["chapters", i, "challenges", j, "id"], message: `must start with ${chapter.id}-` });
        }
      });
    });
  });

export type ColumnInput = z.input<typeof ColumnSchema>;
export type Dataset = z.output<typeof DatasetSchema>;
export type DatasetInput = z.input<typeof DatasetSchema>;
export type Table = z.output<typeof TableSchema>;
export type Challenge = z.output<typeof ChallengeSchema>;
export type ChallengeInput = z.input<typeof ChallengeSchema>;
export type Chapter = z.output<typeof ChapterSchema>;
export type ChapterInput = z.input<typeof ChapterSchema>;
export type Tier = z.output<typeof TierSchema>;
export type TierInput = z.input<typeof TierSchema>;
