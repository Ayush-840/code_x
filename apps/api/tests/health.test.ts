import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createApp } from "../src/app";

describe("API Health", () => {
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof express.Application.prototype.listen>;

  beforeAll(() => {
    app = createApp();
    server = app.listen(0);
  });

  afterAll(() => {
    server?.close();
  });

  it("GET /health returns ok", async () => {
    const port = (server.address() as { port: number })?.port;
    const res = await fetch(`http://localhost:${port}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("GET /nonexistent returns 404", async () => {
    const port = (server.address() as { port: number })?.port;
    const res = await fetch(`http://localhost:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });
});
