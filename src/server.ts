import cors from "cors";
import express from "express";
import { config } from "./config/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestContextMiddleware } from "./middleware/requestContext.js";
import { gtActionRouter } from "./routes/gtAction.js";
import { gtHealthRouter } from "./routes/gtHealth.js";
import { gtVoiceRouter } from "./routes/gtVoice.js";

export const createServer = () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: config.requestBodyLimit }));
  app.use(requestContextMiddleware);

  app.get("/gt/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      service: config.serviceName,
      scope: "greattime",
      time: new Date().toISOString(),
    });
  });

  app.use("/health", gtHealthRouter);
  app.use("/api/gt/voice", gtVoiceRouter);
  app.use("/api/gt/action", gtActionRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
