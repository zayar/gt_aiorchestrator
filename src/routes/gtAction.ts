import { Router } from "express";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { handleConfirmAction } from "../handlers/gtActionHandlers.js";

export const gtActionRouter = Router();

gtActionRouter.post("/confirm", (req, res, next) => {
  void handleConfirmAction(req as RequestWithContext, res).catch(next);
});
