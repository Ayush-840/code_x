import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createApp } from "../src/app";

/**
 * The OAuth state is now self-validating (HMAC-signed, no cookie required).
 * These tests exercise the real routes against a live app instance so both
 * /v1/auth/github (signing) and /v1/auth/github/callback (verification) are
 * covered end-to-end at the HTTP layer. Prisma is never reached because the
 * callback always fails before the DB upsert when GitHub rejects the fake code.
 */
describe("OAuth state flow", () => {
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof express.Application.prototype.listen>;
  let baseUrl: string;

  beforeAll(() => {
    app = createApp();
    server = app.listen(0);
    const port = (server.address() as { port: number })?.port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  function extractState(location: string): string {
    const url = new URL(location);
    const state = url.searchParams.get("state");
    expect(state, "authorize redirect must contain state").toBeTruthy();
    return state as string;
  }

  it("issues a signed state (nonce.issuedAt.hmac) on /v1/auth/github", async () => {
    const res = await fetch(`${baseUrl}/v1/auth/github`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const state = extractState(res.headers.get("location") as string);
    // nonce(32 hex) . issuedAt(base36) . hmac(base64url)
    expect(state.split(".").length).toBe(3);
    expect(state.split(".")[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("callback with a valid signed state but bad code redirects to login with an error (not VALIDATION_ERROR)", async () => {
    const init = await fetch(`${baseUrl}/v1/auth/github`, { redirect: "manual" });
    const state = extractState(init.headers.get("location") as string);

    const res = await fetch(
      `${baseUrl}/v1/auth/github/callback?code=fake&state=${encodeURIComponent(state)}`,
      { headers: { cookie: init.headers.get("set-cookie") ?? "" }, redirect: "manual" }
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") as string;
    expect(location).toContain("/login?error=");
    expect(location).not.toContain("state%20mismatch");
  });

  it("rejects a tampered state signature", async () => {
    const init = await fetch(`${baseUrl}/v1/auth/github`, { redirect: "manual" });
    const state = extractState(init.headers.get("location") as string);
    const [nonce, issuedAt] = state.split(".");
    const tampered = `${nonce}.${issuedAt}.${Buffer.from("badsig").toString("base64url")}`;

    // Callback errors are intentionally surfaced as a redirect back to the
    // login page rather than a JSON error.
    const res = await fetch(
      `${baseUrl}/v1/auth/github/callback?code=fake&state=${encodeURIComponent(tampered)}`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") as string;
    expect(location).toContain("state%20mismatch");
  });

  it("rejects a state older than the max age", async () => {
    // Forge an expired-but-correctly-signed state by signing with the same
    // secret the app uses. JWT_SECRET must be set in the test environment.
    const { createHmac, randomBytes } = await import("node:crypto");
    const secret = process.env.JWT_SECRET as string;
    const nonce = randomBytes(16).toString("hex");
    const staleIssuedAt = (Date.now() - 11 * 60 * 1000).toString(36);
    const payload = `${nonce}.${staleIssuedAt}`;
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    const expired = `${payload}.${sig}`;

    const res = await fetch(
      `${baseUrl}/v1/auth/github/callback?code=fake&state=${encodeURIComponent(expired)}`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") as string;
    expect(location).toContain("state%20mismatch");
  });

  it("rejects when the state cookie does not match the state param (replay across sessions)", async () => {
    const first = await fetch(`${baseUrl}/v1/auth/github`, { redirect: "manual" });
    const stateA = extractState(first.headers.get("location") as string);
    const cookieA = (first.headers.get("set-cookie") ?? "").split(";")[0];

    const second = await fetch(`${baseUrl}/v1/auth/github`, { redirect: "manual" });
    const stateB = extractState(second.headers.get("location") as string);

    // Present session A's cookie but session B's state param
    const res = await fetch(
      `${baseUrl}/v1/auth/github/callback?code=fake&state=${encodeURIComponent(stateB)}`,
      { headers: { cookie: cookieA }, redirect: "manual" }
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") as string;
    expect(location).toContain("state%20mismatch");
  });

  it("maps GitHub ?error=access_denied (user cancelled) to a friendly message, not state mismatch", async () => {
    const init = await fetch(`${baseUrl}/v1/auth/github`, { redirect: "manual" });
    const state = extractState(init.headers.get("location") as string);

    // Clicking "Cancel" on GitHub returns error=access_denied with state but
    // no code — the old callback reported it as "OAuth state mismatch".
    const res = await fetch(
      `${baseUrl}/v1/auth/github/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      { redirect: "manual" }
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") as string;
    expect(location).toContain("/login?error=");
    expect(location).toContain("cancelled");
    expect(location).not.toContain("state%20mismatch");
  });
});
