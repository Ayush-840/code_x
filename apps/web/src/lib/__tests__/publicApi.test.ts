import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, publicGet, publicPost, resolveApiUrl } from "@/lib/publicApi";
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
  });

  it("maps a 202 ok:false envelope (GRAPH_GENERATING) to an error, not undefined data", async () => {
    // 202 is 2xx, so res.ok is true — the ok:false envelope must be the error
    // signal or callers polling "graph is generating" never see it (the
    // CodeGraph tab spun forever on data:undefined before this fix).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "GRAPH_GENERATING", message: "Code graph is being generated." },
          }),
          { status: 202, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const err = await publicGet("/v1/public/abc/codegraph").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(202);
    expect(apiErr.code).toBe("GRAPH_GENERATING");
  });

  it("still maps non-ok responses to the API's structured error", async () => {
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

describe("authed request auto-refresh on TOKEN_EXPIRED", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("refreshes once and replays the original request (sessions survive 15-min expiry)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          { error: { code: "TOKEN_EXPIRED", message: "JWT has expired; refresh required" } },
          401
        )
      )
      .mockResolvedValueOnce(json({ ok: true, data: { success: true } }, 200))
      .mockResolvedValueOnce(json({ ok: true, data: { repos: [] } }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const data = await authedRequest<{ repos: string[] }>("/repos");

    expect(data).toEqual({ repos: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 2nd call is the refresh rotation, 3rd is the replayed original.
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/auth/refresh");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/v1/repos");
  });

  it("maps an authed 202 ok:false envelope (GRAPH_GENERATING) to an error too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          { ok: false, error: { code: "GRAPH_GENERATING", message: "generating" } },
          202
        )
      )
    );

    const err = await authedRequest("/repos/x/graph").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(202);
    expect(apiErr.code).toBe("GRAPH_GENERATING");
  });

  it("gives up after one refresh attempt (no retry loop when refresh fails)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ error: { code: "TOKEN_EXPIRED", message: "expired" } }, 401)
      )
      .mockResolvedValueOnce(
        json({ error: { code: "UNAUTHORIZED", message: "Invalid refresh token" } }, 401)
      );
    vi.stubGlobal("fetch", fetchMock);

    const err = await authedRequest("/repos").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("TOKEN_EXPIRED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
