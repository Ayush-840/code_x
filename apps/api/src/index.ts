import { createApp } from "./app";
import { config } from "./config";
import { assertMigrationsApplied } from "@vibe-coder/database/migrations";

// Fail fast on schema drift (PRD-I03): refuse to accept traffic against a
// database the code expects to be elsewhere, rather than failing every
// request individually with a generic error.
assertMigrationsApplied();

createApp().listen(config.port, () => {
  console.log(`[api] listening on :${config.port}`);
});
