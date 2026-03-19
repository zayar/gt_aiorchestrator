import type { RecommendationPayload } from "../types/contracts.js";
import type { GTCatalogSnapshot, GTService } from "../types/domain.js";
import { normalizeForMatching } from "../utils/matching.js";

export class RecommendationService {
  recommendProductsForService(params: {
    service: GTService;
    catalog: GTCatalogSnapshot;
  }): RecommendationPayload[] {
    const hardLinks = params.catalog.serviceProductLinks
      .filter((link) => link.serviceId === params.service.id)
      .map((link) => ({
        productId: link.productStockItemId,
        productName: link.productName,
        stockItemId: link.productStockItemId,
        stock: link.productStock ?? null,
        price: link.productPrice ?? null,
        reason: `Mapped to ${params.service.name} in GreatTime service-product data`,
        source: "service_mapping" as const,
      }));

    if (hardLinks.length > 0) {
      return hardLinks;
    }

    const serviceTokens = new Set(normalizeForMatching(params.service.name).split(" ").filter(Boolean));
    return params.catalog.products
      .filter((product) => {
        const productTokens = normalizeForMatching(product.name).split(" ").filter(Boolean);
        return productTokens.some((token) => serviceTokens.has(token));
      })
      .slice(0, 3)
      .map((product) => ({
        productId: product.id,
        productName: product.name,
        stockItemId: product.stockItem?.id,
        stock: product.stockItem?.stock ?? null,
        price: product.stockItem?.price ?? null,
        reason: `Token similarity fallback for ${params.service.name}; still grounded to real clinic catalog`,
        source: "catalog_similarity" as const,
      }));
  }
}
