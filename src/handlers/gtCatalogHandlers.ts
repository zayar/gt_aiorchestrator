import type { Response } from "express";
import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import { SessionContextService } from "../services/SessionContextService.js";
import { GTCatalogService } from "../services/GTCatalogService.js";
import type { CatalogBootstrapResponse, CatalogMembersResponse } from "../types/contracts.js";
import type { RequestWithContext } from "../middleware/requestContext.js";

const apiCoreAdapter = new GTApiCoreAdapter();
const sessionContextService = new SessionContextService();
const catalogService = new GTCatalogService(apiCoreAdapter);

const clampTake = (value: unknown, fallback: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, Math.round(parsed));
};

export const handleCatalogBootstrap = async (req: RequestWithContext, res: Response) => {
  const session = sessionContextService.fromRequest(req);
  const memberLimit = clampTake(req.query.memberLimit, 120, 250);

  const [catalog, members] = await Promise.all([
    catalogService.getCatalog(session),
    catalogService.getMemberReferenceList(session, memberLimit),
  ]);

  const response: CatalogBootstrapResponse = {
    clinic: catalog.clinic,
    services: catalog.services,
    products: catalog.products,
    practitioners: catalog.practitioners,
    members,
    serviceProductLinks: catalog.serviceProductLinks,
    loadedAt: new Date().toISOString(),
    memberCount: members.length,
  };

  res.json(response);
};

export const handleCatalogMembers = async (req: RequestWithContext, res: Response) => {
  const session = sessionContextService.fromRequest(req);
  const query = String(req.query.search ?? "").trim();
  const take = clampTake(req.query.take, 40, 100);
  const members = await apiCoreAdapter.searchMembers(session, query);

  const response: CatalogMembersResponse = {
    query,
    members: members.slice(0, take),
    loadedAt: new Date().toISOString(),
  };

  res.json(response);
};
