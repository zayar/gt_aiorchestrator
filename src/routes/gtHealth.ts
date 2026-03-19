import { Router } from "express";
import { config } from "../config/index.js";

export const gtHealthRouter = Router();

gtHealthRouter.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: config.serviceName,
    time: new Date().toISOString(),
  });
});
