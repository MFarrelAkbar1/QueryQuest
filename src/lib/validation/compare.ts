/**
 * Compares a learner's actual result set with a challenge's expected result.
 * Pure: no database, no I/O. Feedback is specific enough to help but never
 * reveals expected values.
 */

export type Cell = string | number | null;

export type ActualResult = {
  columns: string[];
  rows: Cell[][];
  truncated?: boolean;
};

export type ExpectedResult = {
  columns: string[];
  rows: Cell[][];
  /** Only compare row order when the challenge asks for an ORDER BY. */
  ordered: boolean;
};

export type FeedbackCode =
  | "TRUNCATED"
  | "COLUMN_COUNT"
  | "COLUMN_NAMES"
  | "ROW_COUNT"
  | "NULLS"
  | "VALUES"
  | "ORDER";

export type ComparisonResult = { pass: true } | { pass: false; code: FeedbackCode; message: string };

const DECIMAL = /^([+-])?(\d*)(?:\.(\d*))?$/;
const SCIENTIFIC = /^[+-]?(\d+\.?\d*|\.\d+)e[+-]?\d+$/i;

/**
 * Canonical text for a cell so equivalent values compare equal:
 * "3.5000", "3.50", 3.5 and "+3.5" all become "3.5"; "-0.00" becomes "0";
 * "007" becomes "7". Decimals are normalised as text, so there is no float
 * rounding. Non-numeric strings are compared exactly. NULL stays null.
 */
export function normalizeCell(value: Cell): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    value = String(value);
  }

  const text = value.trim();
  if (SCIENTIFIC.test(text)) return normalizeDecimal(String(Number(text))) ?? value;
  return normalizeDecimal(text) ?? value;
}

function normalizeDecimal(text: string): string | undefined {
  const match = DECIMAL.exec(text);
  if (!match) return undefined;
  const [, sign = "", intPart = "", fracPart = ""] = match;
  if (intPart === "" && fracPart === "") return undefined; // "", "+", "."

  const int = intPart.replace(/^0+/, "") || "0";
  const frac = fracPart.replace(/0+$/, "");
  const magnitude = frac ? `${int}.${frac}` : int;
  return magnitude === "0" || sign !== "-" ? magnitude : `-${magnitude}`;
}

/** A stable key for a normalised row, used for multiset comparison. */
function rowKey(row: (string | null)[]): string {
  return JSON.stringify(row);
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function sameCounts(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, n] of a) if (b.get(k) !== n) return false;
  return true;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function compareResults(actual: ActualResult, expected: ExpectedResult): ComparisonResult {
  if (actual.truncated) {
    return {
      pass: false,
      code: "TRUNCATED",
      message: `Your query returned too many rows (expected ${plural(expected.rows.length, "row")}). Check your WHERE conditions and joins.`,
    };
  }

  if (actual.columns.length !== expected.columns.length) {
    return {
      pass: false,
      code: "COLUMN_COUNT",
      message: `You returned ${plural(actual.columns.length, "column")}, expected ${expected.columns.length}.`,
    };
  }

  // MySQL column labels are case-insensitive.
  for (const [i, name] of expected.columns.entries()) {
    const got = actual.columns[i]!;
    if (got.toLowerCase() !== name.toLowerCase()) {
      return {
        pass: false,
        code: "COLUMN_NAMES",
        message: `Column ${i + 1} should be named \`${name}\`, but yours is \`${got}\`. Check the column order and aliases.`,
      };
    }
  }

  if (actual.rows.length !== expected.rows.length) {
    return {
      pass: false,
      code: "ROW_COUNT",
      message: `You returned ${plural(actual.rows.length, "row")}, expected ${expected.rows.length}.`,
    };
  }

  const actualRows = actual.rows.map((r) => r.map(normalizeCell));
  const expectedRows = expected.rows.map((r) => r.map(normalizeCell));

  if (!sameCounts(countBy(actualRows, rowKey), countBy(expectedRows, rowKey))) {
    for (const [i, name] of expected.columns.entries()) {
      const nullsActual = actualRows.filter((r) => r[i] === null).length;
      const nullsExpected = expectedRows.filter((r) => r[i] === null).length;
      if (nullsActual !== nullsExpected) {
        return {
          pass: false,
          code: "NULLS",
          message: `Column \`${name}\` has ${plural(nullsActual, "NULL value")}, expected ${nullsExpected}.`,
        };
      }
    }
    const column = expected.columns.find((_, i) => {
      const key = (r: (string | null)[]) => JSON.stringify(r[i]);
      return !sameCounts(countBy(actualRows, key), countBy(expectedRows, key));
    });
    return {
      pass: false,
      code: "VALUES",
      message: column
        ? `The values in column \`${column}\` don't match the expected result.`
        : "Each column has the right values, but they are combined into the wrong rows.",
    };
  }

  if (expected.ordered && actualRows.some((row, i) => rowKey(row) !== rowKey(expectedRows[i]!))) {
    return {
      pass: false,
      code: "ORDER",
      message: "You have the right rows, but in the wrong order. Check your ORDER BY.",
    };
  }

  return { pass: true };
}
