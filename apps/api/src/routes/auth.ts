import { Router, type Request, type Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { Octokit } from "octokit";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

const REFRESH_TOKEN_DAYS = 30;
const ACCESS_TOKEN_EXPIRY = "15m";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
): void {
  const { isProd, cookieSameSite } = config;
  const baseOpts = { httpOnly: true, secure: isProd, sameSite: cookieSameSite, path: "/" };

  res.cookie("access_token", accessToken, {
    ...baseOpts,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie("refresh_token", refreshToken, {
    ...baseOpts,
    maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000, // 30 days
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
}

// GET /v1/auth/github — initiate OAuth flow
router.get("/github", (_req, res) => {
  const state = randomBytes(16).toString("hex");
  const { isProd, cookieSameSite } = config;
  res.cookie("oauth_state", state, { httpOnly: true, secure: isProd, sameSite: cookieSameSite });
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${config.apiUrl}/v1/auth/github/callback`,
    scope: "repo,user:email",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /v1/auth/github/callback — exchange code for tokens, set cookies
router.get("/github/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || state !== req.cookies.oauth_state) {
      throw new HttpError(400, "VALIDATION_ERROR", "OAuth state mismatch");
    }

    // Exchange code for GitHub access token
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        redirect_uri: `${config.apiUrl}/v1/auth/github/callback`,
      }),
    });
    const { access_token } = (await tokenResp.json()) as { access_token?: string };
    if (!access_token) {
      throw new HttpError(401, "UNAUTHORIZED", "GitHub did not return a token");
    }

    // Fetch GitHub user info
    const octokit = new Octokit({ auth: access_token });
    const { data: ghUser } = await octokit.rest.users.getAuthenticated();

    // Upsert user in DB
    const user = await prisma.user.upsert({
      where: { githubId: ghUser.id },
      update: {
        username: ghUser.login,
        email: ghUser.email ?? null,
        avatarUrl: ghUser.avatar_url ?? null,
      },
      create: {
        githubId: ghUser.id,
        username: ghUser.login,
        email: ghUser.email ?? null,
        avatarUrl: ghUser.avatar_url ?? null,
        subscriptions: { create: {} },
      },
    });

    // Issue access token (JWT)
    const accessToken = jwt.sign(
      { sub: user.id, githubId: user.githubId },
      config.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY as any }
    );

    // Issue refresh token (opaque, stored hashed in DB)
    const rawRefresh = randomBytes(40).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_DAYS);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefresh),
        expiresAt,
      },
    });

    // Set httpOnly cookies and redirect
    setAuthCookies(res, accessToken, rawRefresh);
    res.redirect(`${config.frontendUrl}/login?authenticated=1`);
  } catch (err) {
    next(err);
  }
});

// POST /v1/auth/refresh — rotate refresh token
router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing refresh token");
    }

    const tokenHash = hashToken(refreshToken);
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid refresh token");
    }
    if (record.revokedAt) {
      throw new HttpError(401, "UNAUTHORIZED", "Refresh token has been revoked");
    }
    if (record.expiresAt < new Date()) {
      throw new HttpError(401, "UNAUTHORIZED", "Refresh token has expired");
    }

    // Revoke old token (rotate)
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    // Issue new access + refresh tokens
    const accessToken = jwt.sign(
      { sub: record.user.id, githubId: record.user.githubId },
      config.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY as any }
    );

    const newRawRefresh = randomBytes(40).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_DAYS);

    await prisma.refreshToken.create({
      data: {
        userId: record.user.id,
        tokenHash: hashToken(newRawRefresh),
        expiresAt,
      },
    });

    setAuthCookies(res, accessToken, newRawRefresh);
    ok(res, { success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/auth/logout — revoke refresh token, clear cookies
router.delete("/logout", async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearAuthCookies(res);
    ok(res, { success: true });
  } catch (err) {
    next(err);
  }
});

// GET /v1/auth/me — return current user (used by frontend to check auth state)
router.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, username: true, email: true, avatarUrl: true, githubId: true },
    });
    if (!user) {
      throw new HttpError(404, "NOT_FOUND", "User not found");
    }
    ok(res, user);
  } catch (err) {
    next(err);
  }
});

export default router;
