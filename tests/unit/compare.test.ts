import { describe, expect, it } from "vitest";
import { compareResults, normalizeCell, type ExpectedResult } from "@/lib/validation/compare";

describe("normalizeCell", () => {
  it.each([
    ["3.5000", "3.5"],
    [3.5, "3.5"],
    ["3.50", "3.5"],
    ["+3.5", "3.5"],
    ["10.00", "10"],
    [10, "10"],
    ["007", "7"],
    ["0.5", "0.5"],
    [".5", "0.5"],
    ["5.", "5"],
    ["-0.00", "0"],
    ["-2.500", "-2.5"],
    ["1e3", "1000"],
    ["2.5E-1", "0.25"],
    ["12345678901234567890.1200", "12345678901234567890.12"],
  ])("normalises %j to %j", (input, output) => {
    expect(normalizeCell(input)).toBe(output);
  });

  it("does not lose precision on long decimals", () => {
    expect(normalizeCell("0.1000000000000000000001")).toBe("0.1000000000000000000001");
    expect(normalizeCell("0.1000000000000000000001")).not.toBe(normalizeCell("0.1"));
  });

  it.each([["Alice"], ["2024-01-05"], ["12:30:00"], ["1.2.3"], [""], ["  "], ["NULL"], ["abc123"]])(
    "leaves non-numeric text %j unchanged",
    (input) => {
      expect(normalizeCell(input)).toBe(input);
    },
  );

  it("keeps NULL distinct from the text 'NULL' and the empty string", () => {
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell("NULL")).not.toBeNull();
    expect(normalizeCell("")).not.toBeNull();
  });
});

const expected = (rows: (string | number | null)[][], ordered = false): ExpectedResult => ({
  columns: ["name", "price"],
  rows,
  ordered,
});

describe("compareResults", () => {
  it("passes on identical results", () => {
    expect(compareResults({ columns: ["name", "price"], rows: [["Mouse", "19.50"]] }, expected([["Mouse", "19.50"]]))).toEqual({
      pass: true,
    });
  });

  it("treats MySQL decimal text and plain numbers as equal (AVG returns 4 decimals)", () => {
    const actual = { columns: ["name", "price"], rows: [["Mouse", "3.5000"], ["Pad", "10.00"]] };
    expect(compareResults(actual, expected([["Mouse", 3.5], ["Pad", 10]]))).toEqual({ pass: true });
    expect(compareResults(actual, expected([["Mouse", "3.5"], ["Pad", "10"]]))).toEqual({ pass: true });
  });

  it("still fails when decimals really differ", () => {
    const actual = { columns: ["name", "price"], rows: [["Mouse", "3.5001"]] };
    expect(compareResults(actual, expected([["Mouse", 3.5]]))).toMatchObject({ pass: false, code: "VALUES" });
  });

  it("compares column names case-insensitively and reports wrong names", () => {
    expect(compareResults({ columns: ["NAME", "Price"], rows: [] }, expected([]))).toEqual({ pass: true });
    expect(compareResults({ columns: ["name", "cost"], rows: [] }, expected([]))).toMatchObject({
      pass: false,
      code: "COLUMN_NAMES",
      message: expect.stringContaining("Column 2 should be named `price`"),
    });
  });

  it("reports the column count", () => {
    expect(compareResults({ columns: ["name"], rows: [] }, expected([]))).toMatchObject({
      pass: false,
      code: "COLUMN_COUNT",
      message: "You returned 1 column, expected 2.",
    });
  });

  it("reports the row count", () => {
    const actual = { columns: ["name", "price"], rows: [["A", "1"], ["B", "2"], ["C", "3"], ["D", "4"]] };
    const exp = expected([["A", 1], ["B", 2], ["C", 3], ["D", 4], ["E", 5]]);
    expect(compareResults(actual, exp)).toMatchObject({
      pass: false,
      code: "ROW_COUNT",
      message: "You returned 4 rows, expected 5.",
    });
  });

  it("compares as a multiset when order does not matter", () => {
    const actual = { columns: ["name", "price"], rows: [["B", "2"], ["A", "1"], ["A", "1"]] };
    expect(compareResults(actual, expected([["A", 1], ["A", 1], ["B", 2]]))).toEqual({ pass: true });
    // Duplicates count: {A, A, B} is not {A, B, B}.
    expect(compareResults(actual, expected([["A", 1], ["B", 2], ["B", 2]]))).toMatchObject({ pass: false });
  });

  it("checks row order only when the challenge requires it", () => {
    const actual = { columns: ["name", "price"], rows: [["B", "2"], ["A", "1"]] };
    expect(compareResults(actual, expected([["A", 1], ["B", 2]], true))).toMatchObject({ pass: false, code: "ORDER" });
    expect(compareResults(actual, expected([["B", 2], ["A", 1]], true))).toEqual({ pass: true });
  });

  it("distinguishes NULL from text", () => {
    const actual = { columns: ["name", "price"], rows: [["A", "NULL"]] };
    expect(compareResults(actual, expected([["A", null]]))).toMatchObject({
      pass: false,
      code: "NULLS",
      message: "Column `price` has 0 NULL values, expected 1.",
    });
  });

  it("names the column whose values differ without revealing them", () => {
    const actual = { columns: ["name", "price"], rows: [["A", "1"], ["B", "9"]] };
    const result = compareResults(actual, expected([["A", 1], ["B", 2]]));
    expect(result).toMatchObject({ pass: false, code: "VALUES" });
    if (!result.pass) {
      expect(result.message).toContain("`price`");
      expect(result.message).not.toMatch(/\b2\b/);
    }
  });

  it("detects values combined into the wrong rows", () => {
    const actual = { columns: ["name", "price"], rows: [["A", "2"], ["B", "1"]] };
    expect(compareResults(actual, expected([["A", 1], ["B", 2]]))).toMatchObject({
      pass: false,
      code: "VALUES",
      message: expect.stringContaining("wrong rows"),
    });
  });

  it("fails truncated results", () => {
    expect(compareResults({ columns: ["name", "price"], rows: [], truncated: true }, expected([]))).toMatchObject({
      pass: false,
      code: "TRUNCATED",
    });
  });
});
