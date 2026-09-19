import { Router } from "express";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { Octokit } from "octokit";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

router.get("/github", async (req, res, next) => {
  try {
    if (!config.githubClientId || !config.githubClientSecret) {
      // No OAuth app configured — mint real tokens for the seeded demo user so
      // the whole app works end-to-end without GitHub credentials.
      const demo = await prisma.user.findUnique({ where: { githubId: 12345678 } });
      if (demo) {
        const token = jwt.sign({ sub: demo.id, githubId: demo.githubId }, config.jwtSecret, {
          expiresIn: config.jwtExpiresIn as any,
        });
        const refresh = jwt.sign({ sub: demo.id, typ: "refresh" }, config.jwtSecret, {
          expiresIn: "30d",
        });
        res.redirect(
          `${config.frontendUrl}/login?token=${token}&refresh=${refresh}&demo=1`
        );
      } else {
        const demoToken = jwt.sign({ sub: "demo-user-unused", typ: "demo" }, config.jwtSecret, {
          expiresIn: config.jwtExpiresIn as any,
        });
        res.redirect(
          `${config.frontendUrl}/login?token=${demoToken}&refresh=${demoToken}&demo=1`
        );
      }
      return;
    }

    const state = randomBytes(16).toString("hex");
    res.cookie("oauth_state", state, { httpOnly: true, sameSite: "lax" });
    const params = new URLSearchParams({
      client_id: config.githubClientId,
      redirect_uri: `${config.apiUrl}/v1/auth/github/callback`,
      scope: "repo,user:email",
      state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  } catch (err) {
    next(err);
  }
});

router.get("/github/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || state !== req.cookies.oauth_state) {
      throw new HttpError(400, "VALIDATION_ERROR", "OAuth state mismatch");
    }

    const tokenResp = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: config.githubClientId,
          client_secret: config.githubClientSecret,
          code,
          redirect_uri: `${config.apiUrl}/v1/auth/github/callback`,
        }),
      }
    );
    const { access_token } = (await tokenResp.json()) as { access_token?: string };
    if (!access_token) {
      throw new HttpError(401, "UNAUTHORIZED", "GitHub did not return a token");
    }

    const octokit = new Octokit({ auth: access_token });
    const { data: ghUser } = await octokit.rest.users.getAuthenticated();

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

    const token = jwt.sign({ sub: user.id, githubId: user.githubId }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });
    const refresh = jwt.sign({ sub: user.id, typ: "refresh" }, config.jwtSecret, {
      expiresIn: "30d",
    });

    res.redirect(`${config.frontendUrl}/login?token=${token}&refresh=${refresh}`);
  } catch (err) {
    next(err);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      throw new HttpError(401, "UNAUTHORIZED", "Missing refresh token");
    }
    const payload = jwt.verify(refreshToken, config.jwtSecret) as {
      sub: string;
      typ?: string;
    };
    if (payload.typ !== "refresh") {
      throw new HttpError(401, "UNAUTHORIZED", "Invalid token type");
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new HttpError(404, "NOT_FOUND", "User does not exist");
    const token = jwt.sign({ sub: user.id, githubId: user.githubId }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });
    ok(res, { accessToken: token });
  } catch (err) {
    next(err);
  }
});

router.delete("/logout", (_req, _res) => {
  // Client discards tokens; stateless JWTs mean no server session to kill.
});

export default router;