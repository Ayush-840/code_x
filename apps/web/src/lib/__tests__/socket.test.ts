import { describe, expect, it } from "vitest";

import { resolveWsUrl } from "@/lib/socket";

describe("resolveWsUrl (PRD-C03)", () => {
  it("throws in production when NEXT_PUBLIC_WS_URL is missing", () => {
    expect(() => resolveWsUrl(undefined, "production")).toThrowError(
      /NEXT_PUBLIC_WS_URL is not set/
    );
  });

  it("falls back to localhost in non-production environments", () => {
    expect(resolveWsUrl(undefined, "development")).toBe("http://localhost:4001");
  });

  it("uses the configured URL in production when set", () => {
    expect(
      resolveWsUrl("https://ws.example.up.railway.app", "production")
    ).toBe("https://ws.example.up.railway.app");
  });
});
