import { loadConfig } from "./config.js";
import { startRunner } from "./runner.js";

const runner = await startRunner(loadConfig());

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    runner.app.log.info(`received ${signal}, shutting down`);
    void runner.stop().then(() => process.exit(0));
  });
}
