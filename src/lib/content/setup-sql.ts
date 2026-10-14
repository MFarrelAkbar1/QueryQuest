import type { Dataset, Table } from "@content/schema";

/** Quotes a value as a MySQL literal. Content is trusted, but values are still escaped. */
export function sqlLiteral(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid number in dataset: ${value}`);
    return String(value);
  }
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function createTable(table: Table): string {
  const columns = table.columns.map((c) => `  \`${c.name}\` ${c.type}${c.nullable ? " NULL" : " NOT NULL"}`);
  const primaryKey = table.columns.filter((c) => c.primaryKey).map((c) => `\`${c.name}\``);
  if (primaryKey.length > 0) columns.push(`  PRIMARY KEY (${primaryKey.join(", ")})`);
  for (const c of table.columns) {
    if (c.references) {
      columns.push(`  FOREIGN KEY (\`${c.name}\`) REFERENCES \`${c.references.table}\` (\`${c.references.column}\`)`);
    }
  }
  return `CREATE TABLE \`${table.name}\` (\n${columns.join(",\n")}\n);`;
}

function insertRows(table: Table): string | undefined {
  if (table.rows.length === 0) return undefined;
  const names = table.columns.map((c) => `\`${c.name}\``).join(", ");
  const values = table.rows.map((row) => `  (${row.map(sqlLiteral).join(", ")})`).join(",\n");
  return `INSERT INTO \`${table.name}\` (${names}) VALUES\n${values};`;
}

/**
 * Builds the schema + seed SQL the runner loads into each temporary database.
 * Tables are created in dataset order, so referenced tables must come first.
 */
export function datasetToSetupSql(dataset: Dataset): string {
  return dataset.tables
    .flatMap((t) => [createTable(t), insertRows(t)])
    .filter((s): s is string => Boolean(s))
    .join("\n\n");
}
