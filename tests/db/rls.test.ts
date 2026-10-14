import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anon, createUser, deleteUser, type TestUser } from "./helpers";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createUser({ display_name: "Alice", timezone: "Europe/Berlin" });
  bob = await createUser({ display_name: "Bob", timezone: "Not/AZone" });
});

afterAll(async () => {
  await deleteUser(alice);
  await deleteUser(bob);
});

describe("new users", () => {
  it("get a profile (with a validated timezone) and a stats row", async () => {
    const { data: profiles } = await admin.from("profiles").select("id, display_name, timezone").in("id", [alice.id, bob.id]);
    expect(profiles).toEqual(
      expect.arrayContaining([
        { id: alice.id, display_name: "Alice", timezone: "Europe/Berlin" },
        { id: bob.id, display_name: "Bob", timezone: "Asia/Jakarta" },
      ]),
    );
    const { data: stats } = await admin.from("player_stats").select("user_id, total_xp").in("user_id", [alice.id, bob.id]);
    expect(stats).toHaveLength(2);
    expect(stats?.every((s) => s.total_xp === 0)).toBe(true);
  });
});

describe("row level security: reading", () => {
  it("users only see their own profile and stats", async () => {
    const profiles = await alice.client.from("profiles").select("id");
    expect(profiles.data).toEqual([{ id: alice.id }]);
    const bobsProfile = await alice.client.from("profiles").select("id").eq("id", bob.id);
    expect(bobsProfile.data).toEqual([]);
    const stats = await alice.client.from("player_stats").select("user_id");
    expect(stats.data).toEqual([{ user_id: alice.id }]);
  });

  it("users never see another user's completions, XP, attempts or hints", async () => {
    await admin.from("challenge_attempts").insert({ user_id: bob.id, challenge_id: "t1-c1-01", passed: false });
    await admin.from("hint_usages").insert({ user_id: bob.id, challenge_id: "t1-c1-01", hint_index: 0 });
    for (const table of ["challenge_completions", "xp_transactions", "challenge_attempts", "hint_usages", "user_achievements"] as const) {
      const { data, error } = await alice.client.from(table).select("user_id");
      expect(error).toBeNull();
      expect(data?.filter((r) => r.user_id !== alice.id)).toEqual([]);
    }
    const bobsOwn = await bob.client.from("challenge_attempts").select("user_id");
    expect(bobsOwn.data).toEqual([{ user_id: bob.id }]);
  });

  it("anonymous visitors can read the achievement catalogue but no user data", async () => {
    const achievements = await anon.from("achievements").select("id").order("sort_order");
    expect(achievements.data?.map((a) => a.id)).toEqual(["first_query", "query_streak", "join_master", "error_hunter"]);
    for (const table of ["profiles", "player_stats", "challenge_completions", "xp_transactions"] as const) {
      const { data } = await anon.from(table).select("*");
      expect(data ?? []).toEqual([]);
    }
  });
});

describe("row level security: writing", () => {
  it("a client cannot insert XP, completions, achievements, attempts or hints", async () => {
    const attempts = [
      alice.client.from("xp_transactions").insert({ user_id: alice.id, amount: 1000, source_type: "challenge", source_id: "t1-c1-01" }),
      alice.client.from("challenge_completions").insert({
        user_id: alice.id,
        challenge_id: "t1-c1-01",
        chapter_id: "t1-c1",
        tier_id: "tier-1",
        xp_awarded: 1000,
      }),
      alice.client.from("user_achievements").insert({ user_id: alice.id, achievement_id: "join_master" }),
      alice.client.from("challenge_attempts").insert({ user_id: alice.id, challenge_id: "t1-c1-01", passed: true }),
      alice.client.from("hint_usages").insert({ user_id: alice.id, challenge_id: "t1-c1-01", hint_index: 0 }),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.error?.code).toBe("42501"); // insufficient_privilege
    }
    const { count } = await admin.from("xp_transactions").select("*", { count: "exact", head: true }).eq("user_id", alice.id);
    expect(count).toBe(0);
  });

  it("a client cannot change its stats", async () => {
    const { error } = await alice.client.from("player_stats").update({ total_xp: 999_999 }).eq("user_id", alice.id);
    expect(error?.code).toBe("42501");
    const { data } = await admin.from("player_stats").select("total_xp").eq("user_id", alice.id).single();
    expect(data?.total_xp).toBe(0);
  });

  it("a user can rename themselves but not edit another profile", async () => {
    const own = await alice.client.from("profiles").update({ display_name: "Alice 2" }).eq("id", alice.id).select("display_name");
    expect(own.data).toEqual([{ display_name: "Alice 2" }]);

    const other = await alice.client.from("profiles").update({ display_name: "Hacked" }).eq("id", bob.id).select();
    expect(other.data).toEqual([]);
    const { data } = await admin.from("profiles").select("display_name").eq("id", bob.id).single();
    expect(data?.display_name).toBe("Bob");
  });

  it("only display_name and timezone are writable on a profile, and timezones are validated", async () => {
    const created = await alice.client.from("profiles").update({ created_at: "2000-01-01T00:00:00Z" }).eq("id", alice.id);
    expect(created.error?.code).toBe("42501");
    const badTz = await alice.client.from("profiles").update({ timezone: "Mars/Olympus" }).eq("id", alice.id);
    expect(badTz.error?.code).toBe("23514"); // check_violation
  });
});
