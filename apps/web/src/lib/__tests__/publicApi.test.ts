import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, publicPost, resolveApiUrl } from "@/lib/publicApi";
import { request as authedRequest } from "@/lib/api";

describe("resolveApiUrl (PRD-C03)", () => {
  it("throws in production when NEXT_PUBLIC_API_URL is missing", () => {
    expect(() => resolveApiUrl(undefined, "production")).toThrowError(
      /NEXT_PUBLIC_API_URL is not set/
    );
  });

  it("throws in production when NEXT_PUBLIC_API_URL is empty", () => {
    expect(() => resolveApiUrl("", "production")).toThrowError(
      /NEXT_PUBLIC_API_URL is not set/
    );
  });

  it("falls back to localhost in non-production environments", () => {
    expect(resolveApiUrl(undefined, "development")).toBe("http://localhost:4000");
    expect(resolveApiUrl(undefined, "test")).toBe("http://localhost:4000");
  });

  it("uses the configured URL in production when set", () => {
    expect(
      resolveApiUrl("https://api.example.up.railway.app", "production")
    ).toBe("https://api.example.up.railway.app");
  });
});

describe("publicPost network failure (PRD-C04)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the attempted URL in a NETWORK_ERROR when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    const err = await publicPost("/v1/public/analyze", { repoUrl: "x" }).catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(0);
    expect(apiErr.code).toBe("NETWORK_ERROR");
    expect(apiErr.message).toContain("http://localhost:4000");
    expect(apiErr.message).toContain("CORS");
  });  it("still maps non-ok responses to the API's structured error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "BAD_URL", message: "Invalid repo URL" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const err = await publicPost("/v1/public/analyze", { repoUrl: "x" }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.code).toBe("BAD_URL");
    expect(apiErr.message).toBe("Invalid repo URL");
  });

  it("surfaces the attempted URL on the authed path too (lib/api.ts, PRD-C04)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    const err = await authedRequest("/auth/me").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(0);
    expect(apiErr.code).toBe("NETWORK_ERROR");
    expect(apiErr.message).toContain("http://localhost:4000");
    expect(apiErr.message).toContain("CORS");
  });
});
