import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { requireAuth } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/errors";
import { config } from "./config";
import { getReadiness } from "./services/readiness";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import repoRoutes from "./routes/repos";
import artifactRoutes from "./routes/artifacts";
import fileExplainRoutes from "./routes/fileExplain";
import chatRoutes from "./routes/chat";
import mockInterviewRoutes from "./routes/mockInterviews";
import usageRoutes from "./routes/usage";
import billingRoutes from "./routes/billing";
import publicAnalysisRoutes from "./routes/publicAnalysis";
import codegraphRoutes, { publicRouter as publicCodegraphRoutes } from "./routes/codegraph";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true); // same-origin / server-to-server
        if (config.allowedOrigins.includes(origin)) return callback(null, true);
        if (config.previewPattern && config.previewPattern.test(origin)) return callback(null, true);
        // Disallowed origins: suppress CORS headers instead of throwing, so
        // scanner/preview traffic gets a normal response without a 500 (and
        // without the access-control headers, browsers block it client-side).
        callback(null, false);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));

  // Liveness vs readiness: /health says the process is up; /health/ready says
  // the analysis pipeline can actually accept work. Deploy tools and the
  // on-call runbook should gate on this one.
  app.get("/health/ready", async (_req, res) => {
    const { ready, deps } = await getReadiness();
    res.status(ready ? 200 : 503).json({ ok: ready, deps });
  });

  app.use("/v1/auth", authRoutes);
  // Must be mounted before any broad `app.use("/v1", requireAuth, ...)` layer:
  // that layer runs requireAuth for every /v1/* request and would 401 these
  // public, no-auth routes before they ever match.
  app.use("/v1/public", publicAnalysisRoutes);
  // Anonymous CodeGraph flow: the public analyze page calls
  // /v1/public/:id/codegraph — mounted here, before any /v1 requireAuth layer,
  // so unauthenticated visitors don't hit the broad auth middleware and get a
  // 401 "Missing or invalid authentication token".
  app.use("/v1/public", publicCodegraphRoutes);
  app.use("/v1/users", requireAuth, userRoutes);
  app.use("/v1/repos", requireAuth, repoRoutes);
  app.use("/v1/repos", requireAuth, artifactRoutes);
  app.use("/v1/repos", requireAuth, fileExplainRoutes);
  app.use("/v1/repos", requireAuth, codegraphRoutes);
  app.use("/v1/chat", requireAuth, chatRoutes);
  app.use("/v1", requireAuth, mockInterviewRoutes);
  app.use("/v1/usage", requireAuth, usageRoutes);
  app.use("/v1/billing", billingRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}