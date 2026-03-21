import { Router } from "express";
import type { RequestWithContext } from "../middleware/requestContext.js";
import { handleCatalogBootstrap, handleCatalogMembers } from "../handlers/gtCatalogHandlers.js";

export const gtCatalogRouter = Router();

gtCatalogRouter.get("/bootstrap", (req, res, next) => {
  void handleCatalogBootstrap(req as RequestWithContext, res).catch(next);
});

gtCatalogRouter.get("/members", (req, res, next) => {
  void handleCatalogMembers(req as RequestWithContext, res).catch(next);
});
