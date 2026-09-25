import { Router, type Request, type Response } from "express";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
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

/**
 * Stateless CSRF protection for the OAuth flow.
 *
 * The `oauth_state` httpOnly cookie alone is not reliable here: the callback is
 * a top-level cross-site navigation (GitHub → Railway), and browsers with
 * third-party cookies blocked silently drop the `SameSite=None` cookie, causing
 * "OAuth state mismatch" errors for users with strict tracking protection.
 *
 * Instead, the state value itself carries a timestamp and an HMAC over both,
 * signed with the JWT secret. The callback verifies the signature and expiry
 * without needing any cookie. The cookie is still set (and checked when
 * present) so the flow also fails closed against replay across browsers.
 */
function signOAuthState(nonce: string): string {
  const issuedAt = Date.now().toString(36);
  const payload = `${nonce}.${issuedAt}`;
  const sig = createHmac("sha256", config.jwtSecret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function verifyOAuthState(state: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, issuedAt, sig] = parts;
  const expected = createHmac("sha256", config.jwtSecret)
    .update(`${nonce}.${issuedAt}`)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }
  const age = Date.now() - parseInt(issuedAt, 36);
  return Number.isFinite(age) && age >= 0 && age <= OAUTH_STATE_MAX_AGE_MS;
}

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
): void {
  const { cookieSecure, cookieSameSite } = config;
  const baseOpts = { httpOnly: true, secure: cookieSecure, sameSite: cookieSameSite, path: "/" };

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
  const nonce = randomBytes(16).toString("hex");
  const state = signOAuthState(nonce);
  const { cookieSecure, cookieSameSite } = config;
  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    // Explicit path so set and clear target the same cookie, and so the
    // cookie is sent to the callback below (it lives under /v1/auth).
    path: "/v1/auth",
  });
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    scope: "repo,user:email",
    state,
  });
  // Only sent when the deployment declares API_URL (which must match the
  // OAuth App's registered callback); see config.githubRedirectUri.
  if (config.githubRedirectUri) params.set("redirect_uri", config.githubRedirectUri);
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /v1/auth/github/callback — exchange code for tokens, set cookies
router.get("/github/callback", async (req, res, next) => {
  try {
    const { code, state, error } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    // A user who clicks "Cancel" on GitHub arrives as ?error=access_denied
    // with no code. Report that as what it is — not "state mismatch".
    if (error && !code) {
      throw new HttpError(
        400,
        "OAUTH_DENIED",
        error === "access_denied"
          ? "GitHub sign-in was cancelled — no access was granted."
          : "GitHub sign-in failed. Please try again."
      );
    }
    const cookieState = req.cookies?.oauth_state;
    // The signed state must always be valid. When the browser kept the
    // oauth_state cookie, it must also match — a mismatch means someone
    // replayed a state from a different session.
    if (!code || !state || !verifyOAuthState(state)) {
      throw new HttpError(400, "VALIDATION_ERROR", "OAuth state mismatch — please try signing in again");
    }
    if (cookieState && cookieState !== state) {
      throw new HttpError(400, "VALIDATION_ERROR", "OAuth state mismatch — please try signing in again");
    }

    // Exchange code for GitHub access token
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        // Must be present here whenever it was sent in the authorize step.
        ...(config.githubRedirectUri ? { redirect_uri: config.githubRedirectUri } : {}),
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
    res.clearCookie("oauth_state", { path: "/v1/auth" });
    res.redirect(`${config.frontendUrl}/login?authenticated=1`);
  } catch (err) {
    // The user arrived here via a top-level browser navigation from GitHub, so
    // send them back to a recoverable UI state instead of dumping raw JSON.
    // The login page already renders ?error= messages.
    res.clearCookie("oauth_state", { path: "/v1/auth" });
    const message =
      err instanceof HttpError ? err.message : "Sign-in failed. Please try again.";
    res.redirect(`${config.frontendUrl}/login?error=${encodeURIComponent(message)}`);
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
