import mysql from "mysql2/promise";
import { loadConfig, type Config } from "../../src/config.js";

/** Defaults match the dev-only placeholders in docker-compose.yml (MySQL on 127.0.0.1:3307). */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    RUNNER_SECRET: "test_runner_secret_0123456789_abcdef",
    MYSQL_HOST: process.env.MYSQL_HOST ?? "127.0.0.1",
    MYSQL_PORT: process.env.MYSQL_PORT ?? "3307",
    RUNNER_ADMIN_USER: process.env.RUNNER_ADMIN_USER ?? "qq_admin",
    RUNNER_ADMIN_PASSWORD: process.env.RUNNER_ADMIN_PASSWORD ?? "devonly-admin-password-not-secret",
    ...overrides,
  });
}

/** Root is only used by tests, to inspect server state the runner itself cannot see. */
export function rootConnection() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3307),
    user: "root",
    password: process.env.MYSQL_ROOT_PASSWORD ?? "devonly-root-password-not-secret",
    multipleStatements: true,
  });
}

export async function leftovers(root: mysql.Connection) {
  const [dbs] = await root.query<mysql.RowDataPacket[]>(
    "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'qq\\_tmp\\_%'",
  );
  const [users] = await root.query<mysql.RowDataPacket[]>("SELECT User AS name FROM mysql.user WHERE User LIKE 'qq\\_u\\_%'");
  return { databases: dbs.map((r) => r.name as string), users: users.map((r) => r.name as string) };
}

export const SHOP_SETUP = `
CREATE TABLE products (
  id INT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  price DECIMAL(8,2) NOT NULL,
  category VARCHAR(30) NULL
);
INSERT INTO products VALUES
  (1, 'Keyboard', 49.90, 'Hardware'),
  (2, 'Mouse', 19.50, 'Hardware'),
  (3, 'SQL Book', 35.00, NULL);
`;
