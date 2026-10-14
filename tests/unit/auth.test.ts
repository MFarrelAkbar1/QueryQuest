import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/redirect";
import { LoginSchema, SignUpSchema, UpdatePasswordSchema } from "@/lib/schemas/auth";

describe("auth request validation", () => {
  it("accepts a valid sign-up and trims the display name", () => {
    const parsed = SignUpSchema.parse({ displayName: "  Ada  ", email: "ada@example.com", password: "correct horse" });
    expect(parsed.displayName).toBe("Ada");
  });

  it.each([
    [{ displayName: "", email: "ada@example.com", password: "12345678" }, "displayName"],
    [{ displayName: "Ada", email: "not-an-email", password: "12345678" }, "email"],
    [{ displayName: "Ada", email: "ada@example.com", password: "short" }, "password"],
    [{ displayName: "Ada", email: "ada@example.com", password: "x".repeat(73) }, "password"],
    [{ displayName: "x".repeat(51), email: "ada@example.com", password: "12345678" }, "displayName"],
  ])("rejects invalid sign-up %#", (input, field) => {
    const result = SignUpSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it("requires login fields", () => {
    expect(LoginSchema.safeParse({ email: "ada@example.com", password: "" }).success).toBe(false);
    expect(LoginSchema.safeParse({ email: "ada@example.com", password: "x" }).success).toBe(true);
  });

  it("requires matching new passwords", () => {
    const result = UpdatePasswordSchema.safeParse({ password: "new password", confirmPassword: "other one" });
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/learn/t1-c1-01", "/learn/t1-c1-01"],
    ["/dashboard?x=1", "/dashboard?x=1"],
    [undefined, "/dashboard"],
    ["", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("%s → %s", (input, output) => {
    expect(safeNextPath(input)).toBe(output);
  });
});
