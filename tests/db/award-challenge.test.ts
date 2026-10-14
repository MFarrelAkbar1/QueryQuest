import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { admin, anon, createUser, deleteUser, type TestUser } from "./helpers";

const CHAPTER = ["t1-c1-01", "t1-c1-02", "t1-c1-03"];
const TIER = [...CHAPTER, "t1-c2-01"];

const args = (userId: string, challengeId: string, overrides: Record<string, unknown> = {}) => ({
  p_user_id: userId,
  p_challenge_id: challengeId,
  p_chapter_id: "t1-c1",
  p_tier_id: "tier-1",
  p_xp: 10,
  p_chapter_challenge_ids: CHAPTER,
  p_chapter_bonus: 50,
  p_tier_challenge_ids: TIER,
  p_tier_bonus: 150,
  p_join_chapter_id: "t3-c3",
  ...overrides,
});

type Award = {
  alreadyCompleted: boolean;
  xpGained: number;
  chapterCompleted: boolean;
  tierCompleted: boolean;
  newAchievements: string[];
  totalXp: number;
  currentStreak: number;
};

async function award(userId: string, challengeId: string, overrides: Record<string, unknown> = {}): Promise<Award> {
  const { data, error } = await admin.rpc("award_challenge", args(userId, challengeId, overrides));
  if (error) throw error;
  return data as unknown as Award;
}

let user: TestUser;
beforeEach(async () => {
  user = await createUser();
});
afterEach(async () => {
  await deleteUser(user);
});

describe("award_challenge permissions", () => {
  it("cannot be executed by a signed-in user", async () => {
    const { error } = await user.client.rpc("award_challenge", args(user.id, "t1-c1-01"));
    expect(error?.code).toBe("42501");
    const { data } = await admin.from("player_stats").select("total_xp").eq("user_id", user.id).single();
    expect(data?.total_xp).toBe(0);
  });

  it("cannot be executed anonymously", async () => {
    const { error } = await anon.rpc("award_challenge", args(user.id, "t1-c1-01"));
    expect(error?.code).toBe("42501");
  });

  it("rejects a challenge that is not part of the given chapter", async () => {
    await expect(award(user.id, "t9-c9-99")).rejects.toMatchObject({ message: expect.stringContaining("not part of") });
  });
});

describe("idempotent rewards", () => {
  it("awards challenge XP exactly once", async () => {
    const first = await award(user.id, "t1-c1-01");
    expect(first).toMatchObject({ alreadyCompleted: false, xpGained: 10, totalXp: 10, currentStreak: 1 });
    expect(first.newAchievements).toEqual(["first_query"]);

    const second = await award(user.id, "t1-c1-01");
    expect(second).toMatchObject({ alreadyCompleted: true, xpGained: 0, totalXp: 10, newAchievements: [] });

    const { data: stats } = await admin.from("player_stats").select("total_xp, challenges_completed").eq("user_id", user.id).single();
    expect(stats).toEqual({ total_xp: 10, challenges_completed: 1 });
    const { count } = await admin.from("xp_transactions").select("*", { count: "exact", head: true }).eq("user_id", user.id);
    expect(count).toBe(1);
  });

  it("awards XP once even when submissions race", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => award(user.id, "t1-c1-01")));
    expect(results.filter((r) => !r.alreadyCompleted)).toHaveLength(1);
    const { data } = await admin.from("player_stats").select("total_xp, challenges_completed").eq("user_id", user.id).single();
    expect(data).toEqual({ total_xp: 10, challenges_completed: 1 });
  });

  it("awards the chapter bonus once, when the last challenge of the chapter is done", async () => {
    expect((await award(user.id, "t1-c1-01")).chapterCompleted).toBe(false);
    expect((await award(user.id, "t1-c1-02")).chapterCompleted).toBe(false);
    const last = await award(user.id, "t1-c1-03");
    expect(last).toMatchObject({ chapterCompleted: true, xpGained: 10 + 50, totalXp: 30 + 50 });
    // Query Streak: three completions in quick succession.
    expect(last.newAchievements).toContain("query_streak");

    expect((await award(user.id, "t1-c1-03")).xpGained).toBe(0);
    const { data } = await admin.from("xp_transactions").select("source_type, amount").eq("user_id", user.id).eq("source_type", "chapter_bonus");
    expect(data).toEqual([{ source_type: "chapter_bonus", amount: 50 }]);
  });

  it("awards the tier bonus once the whole tier is complete", async () => {
    for (const id of CHAPTER) await award(user.id, id);
    const final = await award(user.id, "t1-c2-01", { p_chapter_id: "t1-c2", p_chapter_challenge_ids: ["t1-c2-01"] });
    expect(final).toMatchObject({ tierCompleted: true, chapterCompleted: true, xpGained: 10 + 50 + 150 });
    expect(final.totalXp).toBe(4 * 10 + 2 * 50 + 150);
  });

  it("records hints used and awards Error Hunter after a failed attempt", async () => {
    await admin.from("hint_usages").insert([
      { user_id: user.id, challenge_id: "t1-c1-02", hint_index: 0 },
      { user_id: user.id, challenge_id: "t1-c1-02", hint_index: 1 },
    ]);
    await admin.from("challenge_attempts").insert({ user_id: user.id, challenge_id: "t1-c1-02", passed: false, feedback_code: "ROW_COUNT" });
    const result = await award(user.id, "t1-c1-02");
    expect(result.newAchievements).toEqual(expect.arrayContaining(["first_query", "error_hunter"]));
    const { data } = await admin.from("challenge_completions").select("hints_used").eq("user_id", user.id).single();
    expect(data?.hints_used).toBe(2);
  });

  it("awards Join Master when the JOIN chapter is completed", async () => {
    const joinArgs = { p_chapter_id: "t3-c3", p_tier_id: "tier-3", p_chapter_challenge_ids: ["t3-c3-01"], p_tier_challenge_ids: ["t3-c3-01", "t3-c4-01"] };
    const result = await award(user.id, "t3-c3-01", joinArgs);
    expect(result.newAchievements).toContain("join_master");
  });

  it("refuses negative XP", async () => {
    await expect(award(user.id, "t1-c1-01", { p_xp: -10 })).rejects.toMatchObject({ message: expect.stringContaining("negative") });
  });
});
