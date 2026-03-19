import { Router } from "express";
import multer from "multer";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { handleAnalyze, handleQuery } from "../handlers/gtVoiceHandlers.js";

export const gtVoiceRouter = Router();

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024,
  },
});

gtVoiceRouter.post("/analyze", audioUpload.single("audio"), (req, res, next) => {
  void handleAnalyze(req as RequestWithContext, res).catch(next);
});

gtVoiceRouter.post("/query", audioUpload.single("audio"), (req, res, next) => {
  void handleQuery(req as RequestWithContext, res).catch(next);
});
