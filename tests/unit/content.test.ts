import { describe, expect, it } from "vitest";
import { content, parseContent } from "@content/index";
import { ChallengeSchema, DatasetSchema, type ChallengeInput } from "@content/schema";
import { datasetInputs, tierInputs } from "@content/tiers";
import { allChallenges, getChallengeContext, setupSqlFor } from "@/lib/content";
import { datasetToSetupSql, sqlLiteral } from "@/lib/content/setup-sql";

describe("content files", () => {
  it("all parse against the schema", () => {
    expect(() => parseContent()).not.toThrow();
  });

  it("contain the first 10 Tier 1 challenges, with Tiers 4–5 marked coming soon", () => {
    const tier1 = content.tiers.find((t) => t.id === "tier-1")!;
    expect(tier1.chapters.flatMap((c) => c.challenges)).toHaveLength(10);
    for (const id of ["tier-4", "tier-5"]) {
      const tier = content.tiers.find((t) => t.id === id)!;
      expect(tier.status).toBe("coming-soon");
      expect(tier.chapters).toEqual([]);
    }
  });

  it.each(allChallenges.map((c) => [c.challenge.id, c.challenge] as const))("%s is complete", (_id, challenge) => {
    expect(challenge.hints.length).toBeGreaterThanOrEqual(1);
    expect(challenge.hints.length).toBeLessThanOrEqual(3);
    expect(challenge.expected.rows.length).toBeGreaterThan(0);
    expect(challenge.xp).toBeGreaterThan(0);
    // The last hint may get close, but must not be the reference solution verbatim.
    expect(challenge.hints.at(-1)).not.toBe(challenge.solution.sql);
    expect(setupSqlFor(challenge)).toContain("CREATE TABLE");
  });

  it("links challenges in course order for previous/next navigation", () => {
    const first = getChallengeContext("t1-c1-01")!;
    expect(first.previousId).toBeUndefined();
    expect(first.nextId).toBe("t1-c1-02");
    const crossChapter = getChallengeContext("t1-c1-03")!;
    expect(crossChapter.nextId).toBe("t1-c2-01");
  });

  it("rejects duplicate ids and unknown datasets", () => {
    const duplicated = structuredClone(tierInputs);
    duplicated[0]!.chapters[1]!.challenges[0]!.id = "t1-c2-02";
    expect(() => parseContent(duplicated, datasetInputs)).toThrow(/duplicate id t1-c2-02/);

    const unknownDataset = structuredClone(tierInputs);
    unknownDataset[0]!.chapters[0]!.challenges[0]!.datasetId = "nope";
    expect(() => parseContent(unknownDataset, datasetInputs)).toThrow(/unknown dataset nope/);
  });

  it("rejects coming-soon tiers with content and chapters with too few challenges", () => {
    const tiers = structuredClone(tierInputs);
    tiers[1]!.chapters = [tiers[0]!.chapters[0]!];
    expect(() => parseContent(tiers, datasetInputs)).toThrow();

    const short = structuredClone(tierInputs);
    short[0]!.chapters[0]!.challenges = short[0]!.chapters[0]!.challenges.slice(0, 2);
    expect(() => parseContent(short, datasetInputs)).toThrow();
  });
});

describe("ChallengeSchema", () => {
  const base = tierInputs[0]!.chapters[0]!.challenges[0]! as ChallengeInput;

  it("defaults XP from difficulty", () => {
    expect(ChallengeSchema.parse({ ...base, xp: undefined, difficulty: "hard" }).xp).toBe(30);
  });

  it("requires verificationSql for DML challenges only", () => {
    expect(() => ChallengeSchema.parse({ ...base, statementType: "dml" })).toThrow(/verificationSql/);
    expect(() => ChallengeSchema.parse({ ...base, verificationSql: "SELECT 1" })).toThrow(/only DML/);
  });

  it("allows at most 3 hints and checks expected row widths", () => {
    expect(() => ChallengeSchema.parse({ ...base, hints: ["a", "b", "c", "d"] })).toThrow();
    expect(() =>
      ChallengeSchema.parse({ ...base, expected: { columns: ["a", "b"], rows: [["only one"]], ordered: false } }),
    ).toThrow(/row width/);
  });
});

describe("dataset → setup SQL", () => {
  it("escapes string literals", () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral("back\\slash")).toBe("'back\\\\slash'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(42)).toBe("42");
  });

  it("creates tables with keys, NULL-ability and foreign keys, then inserts rows", () => {
    const dataset = DatasetSchema.parse({
      id: "demo",
      title: "Demo",
      description: "Demo",
      tables: [
        { name: "a", description: "A", columns: [{ name: "id", type: "INT", primaryKey: true }], rows: [[1]] },
        {
          name: "b",
          description: "B",
          columns: [
            { name: "id", type: "INT", primaryKey: true },
            { name: "a_id", type: "INT", nullable: true, references: { table: "a", column: "id" } },
          ],
          rows: [[1, null]],
        },
      ],
    });
    expect(datasetToSetupSql(dataset)).toBe(
      [
        "CREATE TABLE `a` (\n  `id` INT NOT NULL,\n  PRIMARY KEY (`id`)\n);",
        "INSERT INTO `a` (`id`) VALUES\n  (1);",
        "CREATE TABLE `b` (\n  `id` INT NOT NULL,\n  `a_id` INT NULL,\n  PRIMARY KEY (`id`),\n  FOREIGN KEY (`a_id`) REFERENCES `a` (`id`)\n);",
        "INSERT INTO `b` (`id`, `a_id`) VALUES\n  (1, NULL);",
      ].join("\n\n"),
    );
  });

  it("rejects rows that do not match the columns and unknown foreign keys", () => {
    const table = { name: "t", description: "T", columns: [{ name: "id", type: "INT" }], rows: [[1, 2]] };
    expect(() => DatasetSchema.parse({ id: "x", title: "X", description: "X", tables: [table] })).toThrow(/expected 1 values/);
    const badRef = {
      name: "t",
      description: "T",
      columns: [{ name: "id", type: "INT", references: { table: "missing", column: "id" } }],
      rows: [],
    };
    expect(() => DatasetSchema.parse({ id: "x", title: "X", description: "X", tables: [badRef] })).toThrow(/unknown reference/);
  });
});
