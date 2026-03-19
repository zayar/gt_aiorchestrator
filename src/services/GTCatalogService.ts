import { config } from "../config/index.js";
import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import type { GTCatalogSnapshot } from "../types/domain.js";
import type { GTSessionContext } from "../types/session.js";
import { TTLCache } from "../utils/cache.js";
import { logger } from "../utils/logger.js";

export class GTCatalogService {
  private readonly cache = new TTLCache<GTCatalogSnapshot>(config.catalogCacheTtlMs);

  constructor(private readonly apiCoreAdapter: GTApiCoreAdapter) {}

  async getCatalog(session: GTSessionContext): Promise<GTCatalogSnapshot> {
    const cacheKey = session.clinicId;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const [clinic, services, products, practitioners, serviceProductLinks] = await Promise.all([
      this.apiCoreAdapter.getClinic(session),
      this.apiCoreAdapter.getServices(session),
      this.apiCoreAdapter.getProducts(session),
      this.apiCoreAdapter.getPractitioners(session),
      this.apiCoreAdapter.getServiceProductLinks(session),
    ]);

    const snapshot: GTCatalogSnapshot = {
      clinic,
      services,
      products,
      practitioners,
      serviceProductLinks,
      loadedAt: new Date().toISOString(),
    };

    this.cache.set(cacheKey, snapshot);
    logger.info("GT catalog snapshot prepared", {
      requestId: session.requestId,
      clinicId: session.clinicId,
      serviceCount: services.length,
      productCount: products.length,
      practitionerCount: practitioners.length,
      serviceProductLinkCount: serviceProductLinks.length,
    });

    return snapshot;
  }
}
