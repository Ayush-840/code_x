/**
 * Boot-time schema guard (TRD §4 — resolves PRD-I03).
 *
 * Turns "every job fails at runtime with a confusing error" into "the service
 * refuses to boot, with an explicit log line". Runs `prisma migrate status`
 * against the live database and throws if migrations are pending or the
 * schema has drifted; callers exit the process on throw.
 *
 * Plain JS at the package root, same as the generated Prisma client, so both
 * tsx (dev) and compiled dist/ (prod) can require it with zero build step.
 */
const { execSync } = require("node:child_process");

function assertMigrationsApplied({ cwd = __dirname, timeoutMs = 20_000 } = {}) {
  let output = "";
  try {
    output = execSync("npx prisma migrate status", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      env: process.env,
    });
  } catch (err) {
    // Non-zero exit: either the check found a problem or the DB/CLI itself is
    // unreachable — both are fatal at boot.
    const stderr = String(err?.stderr ?? "");
    const finalErr =
      /Cannot find module/i.test(String(err?.message ?? "")) && /prisma/i.test(stderr + String(err?.message ?? ""))
        ? new Error(
            "Migration check failed because the Prisma CLI is unavailable. " +
              "Install dependencies (which include `prisma`) and retry."
          )
        : err instanceof Error
          ? err
          : new Error(String(err));
    console.error("[startup] Migration check failed — refusing to start.", finalErr.message);
    throw finalErr;
  }

  if (/have not yet been applied/i.test(output) || /drift/i.test(output)) {
    const pendingErr = new Error(
      `Pending or drifted migrations detected:\n${output.trim()}`
    );
    console.error("[startup] Migration check failed — refusing to start.", pendingErr.message);
    throw pendingErr;
  }

  console.log("[startup] Migration check passed");
}

module.exports = { assertMigrationsApplied };
