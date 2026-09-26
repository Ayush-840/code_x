import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * githubRedirectUri resolution (apps/api/src/config.ts):
 *   1. GITHUB_REDIRECT_URI wins when set (pinned callback, e.g. after a
 *      Railway domain rename where the GitHub App still points at the old URL)
 *   2. otherwise derived from API_URL + the callback path
 *   3. null when neither is set (omit redirect_uri; GitHub uses the
 *      registered callback)
 *
 * config.ts reads env at import time, so each case re-imports a fresh module
 * after setting process.env directly.
 */
describe("githubRedirectUri resolution", () => {
  // dotenv would pull the developer's root .env into process.env (config.ts
  // walks up to the workspace root) and make these tests machine-dependent —
  // stub it out so each import sees exactly the env the test sets.
  vi.mock("dotenv", () => ({ config: () => ({}) }));

  const REQUIRED = {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-secret-at-least-32-chars-long",
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.GITHUB_REDIRECT_URI;
    delete process.env.API_URL;
    Object.assign(process.env, REQUIRED);
  });

  afterEach(() => {
    for (const key of [...Object.keys(REQUIRED), "GITHUB_REDIRECT_URI", "API_URL"]) {
      delete process.env[key];
    }
  });

  async function importConfig() {
    return import("../src/config");
  }

  it("derives the callback from API_URL when no override is set (trailing slash stripped)", async () => {
    process.env.API_URL = "https://api.example.up.railway.app/";
    const { config } = await importConfig();
    expect(config.githubRedirectUri).toBe(
      "https://api.example.up.railway.app/v1/auth/github/callback"
    );
  });

  it("prefers GITHUB_REDIRECT_URI over the API_URL derivation", async () => {
    process.env.API_URL = "https://api.example.up.railway.app";
    process.env.GITHUB_REDIRECT_URI = "https://oauth.example.com/callback/";
    const { config } = await importConfig();
    expect(config.githubRedirectUri).toBe("https://oauth.example.com/callback");
  });

  it("falls back to the API_URL derivation when the override is blank", async () => {
    process.env.API_URL = "https://api.example.up.railway.app";
    process.env.GITHUB_REDIRECT_URI = "   ";
    const { config } = await importConfig();
    expect(config.githubRedirectUri).toBe(
      "https://api.example.up.railway.app/v1/auth/github/callback"
    );
  });

  it("is null when neither GITHUB_REDIRECT_URI nor API_URL is set (omit redirect_uri)", async () => {
    const { config } = await importConfig();
    expect(config.githubRedirectUri).toBeNull();
  });
});
