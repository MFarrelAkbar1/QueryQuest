/**
 * Runner-side statement checks. This is one layer of defence; the per-execution
 * MySQL user's grants and READ ONLY sessions are the others.
 *
 * The tokenizer understands MySQL quoting and comments, so `;` or keywords inside
 * strings, identifiers and comments are never mistaken for statement structure.
 */

export type AllowedStatement = "select" | "dml";
export type StatementType = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export type StatementCheck =
  | { ok: true; statementType: StatementType }
  | { ok: false; code: "STATEMENT_NOT_ALLOWED" | "MULTIPLE_STATEMENTS" | "SQL_ERROR"; message: string };

type Token = { kind: "word" | "punct" | "string" | "ident" | "var"; value: string };

class TokenizeError extends Error {}

const isWordChar = (c: string) => /[A-Za-z0-9_$]/.test(c);

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const readQuoted = (quote: string): string => {
    // Supports backslash escapes and doubled quotes ('it''s'). Backtick identifiers
    // only support doubling.
    let out = "";
    i++;
    while (i < sql.length) {
      const c = sql[i]!;
      if (c === "\\" && quote !== "`") {
        out += c + (sql[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === quote) {
        if (sql[i + 1] === quote) {
          out += c;
          i += 2;
          continue;
        }
        i++;
        return out;
      }
      out += c;
      i++;
    }
    throw new TokenizeError("Your query has an unterminated quoted string or identifier.");
  };

  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1] ?? "";

    if (/\s/.test(c)) {
      i++;
    } else if (c === "#" || (c === "-" && next === "-" && (i + 2 >= sql.length || sql.charCodeAt(i + 2) <= 32))) {
      // MySQL only treats `--` as a comment when followed by whitespace or a control char.
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const marker = sql[i + 2];
      if (marker === "!" || marker === "+") {
        // `/*! ... */` is executed by MySQL and `/*+ ... */` can override limits
        // (MAX_EXECUTION_TIME, SET_VAR). Neither is needed for learning.
        throw new TokenizeError(
          marker === "!"
            ? "Executable comments (/*! ... */) are not allowed."
            : "Optimizer hints (/*+ ... */) are not allowed.",
        );
      }
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) throw new TokenizeError("Your query has an unterminated /* comment.");
      i = end + 2;
    } else if (c === "'" || c === '"') {
      tokens.push({ kind: "string", value: readQuoted(c) });
    } else if (c === "`") {
      tokens.push({ kind: "ident", value: readQuoted(c) });
    } else if (c === "@") {
      let j = i + 1;
      while (j < sql.length && (isWordChar(sql[j]!) || sql[j] === "@" || sql[j] === ".")) j++;
      tokens.push({ kind: "var", value: sql.slice(i, j) });
      i = j;
    } else if (isWordChar(c)) {
      let j = i;
      while (j < sql.length && isWordChar(sql[j]!)) j++;
      tokens.push({ kind: "word", value: sql.slice(i, j).toUpperCase() });
      i = j;
    } else {
      tokens.push({ kind: "punct", value: c });
      i++;
    }
  }
  return tokens;
}

/** Splits on top-level `;` and drops empty statements (e.g. a trailing `;`). */
function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [[]];
  for (const t of tokens) {
    if (t.kind === "punct" && t.value === ";") statements.push([]);
    else statements[statements.length - 1]!.push(t);
  }
  return statements.filter((s) => s.length > 0);
}

const isWord = (t: Token | undefined, value: string) => t?.kind === "word" && t.value === value;
const isPunct = (t: Token | undefined, value: string) => t?.kind === "punct" && t.value === value;

/** Returns the index just after the parenthesis group that starts at `start`, or -1. */
function skipParens(tokens: Token[], start: number): number {
  if (!isPunct(tokens[start], "(")) return -1;
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (isPunct(tokens[i], "(")) depth++;
    else if (isPunct(tokens[i], ")")) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Finds the keyword of the statement that follows `WITH [RECURSIVE] cte AS (...), ...`. */
function mainKeywordAfterWith(tokens: Token[]): string | undefined {
  let i = 1;
  if (isWord(tokens[i], "RECURSIVE")) i++;
  for (;;) {
    const name = tokens[i];
    if (!name || (name.kind !== "word" && name.kind !== "ident")) return undefined;
    i++;
    if (isPunct(tokens[i], "(")) {
      i = skipParens(tokens, i);
      if (i === -1) return undefined;
    }
    if (!isWord(tokens[i], "AS")) return undefined;
    i = skipParens(tokens, i + 1);
    if (i === -1) return undefined;
    if (isPunct(tokens[i], ",")) {
      i++;
      continue;
    }
    break;
  }
  while (isPunct(tokens[i], "(")) i++;
  const main = tokens[i];
  return main?.kind === "word" ? main.value : undefined;
}

function leadingKeyword(tokens: Token[]): string | undefined {
  let i = 0;
  while (isPunct(tokens[i], "(")) i++;
  const first = tokens[i];
  if (first?.kind !== "word") return undefined;
  if (first.value === "WITH") return mainKeywordAfterWith(tokens.slice(i));
  return first.value;
}

const ALLOWED: Record<AllowedStatement, readonly StatementType[]> = {
  select: ["SELECT"],
  dml: ["SELECT", "INSERT", "UPDATE", "DELETE"],
};

export function checkStatement(sql: string, allowed: AllowedStatement): StatementCheck {
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (err) {
    if (err instanceof TokenizeError) {
      const notAllowed = err.message.includes("not allowed");
      return { ok: false, code: notAllowed ? "STATEMENT_NOT_ALLOWED" : "SQL_ERROR", message: err.message };
    }
    throw err;
  }

  const statements = splitStatements(tokens);
  if (statements.length === 0) {
    return { ok: false, code: "SQL_ERROR", message: "Your query is empty." };
  }
  if (statements.length > 1) {
    return {
      ok: false,
      code: "MULTIPLE_STATEMENTS",
      message: "Only one SQL statement can be run at a time. Remove the extra statements.",
    };
  }

  const statement = statements[0]!;
  const keyword = leadingKeyword(statement);
  const allowedTypes = ALLOWED[allowed];
  const describe = allowed === "select" ? "SELECT statements" : "SELECT, INSERT, UPDATE and DELETE statements";

  if (!keyword || !(allowedTypes as readonly string[]).includes(keyword)) {
    return {
      ok: false,
      code: "STATEMENT_NOT_ALLOWED",
      message: `This challenge only accepts ${describe}${keyword ? `, not ${keyword}` : ""}.`,
    };
  }

  const words = new Set(statement.filter((t) => t.kind === "word").map((t) => t.value));
  if (words.has("OUTFILE") || words.has("DUMPFILE")) {
    return { ok: false, code: "STATEMENT_NOT_ALLOWED", message: "Writing query results to files is not allowed." };
  }
  if (keyword === "SELECT" && words.has("INTO")) {
    return { ok: false, code: "STATEMENT_NOT_ALLOWED", message: "SELECT ... INTO is not allowed here." };
  }

  return { ok: true, statementType: keyword as StatementType };
}
