import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { requireAuth } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/errors";
import { config } from "./config";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import repoRoutes from "./routes/repos";
import artifactRoutes from "./routes/artifacts";
import chatRoutes from "./routes/chat";
import mockInterviewRoutes from "./routes/mockInterviews";
import usageRoutes from "./routes/usage";
import billingRoutes from "./routes/billing";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true); // same-origin / server-to-server
        if (config.allowedOrigins.includes(origin)) return callback(null, true);
        if (config.previewPattern && config.previewPattern.test(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));

  app.use("/v1/auth", authRoutes);
  app.use("/v1/users", requireAuth, userRoutes);
  app.use("/v1/repos", requireAuth, repoRoutes);
  app.use("/v1/repos", requireAuth, artifactRoutes);
  app.use("/v1/chat", requireAuth, chatRoutes);
  app.use("/v1", requireAuth, mockInterviewRoutes);
  app.use("/v1/usage", requireAuth, usageRoutes);
  app.use("/v1/billing", billingRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}