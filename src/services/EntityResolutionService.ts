import { GTApiCoreAdapter } from "../adapters/GTApiCoreAdapter.js";
import type { CandidateOption, ResolvedEntity } from "../types/contracts.js";
import type {
  GTCatalogSnapshot,
  GTMember,
  GTPractitioner,
  GTProduct,
  GTService,
} from "../types/domain.js";
import type { GTSessionContext } from "../types/session.js";
import { normalizeForMatching, pickBestEntityMatch, pickBestEntityMatchByTexts } from "../utils/matching.js";

export type EntityResolution<TEntity> = {
  state: "resolved" | "ambiguous" | "missing";
  resolved?: ResolvedEntity<TEntity>;
  options: CandidateOption[];
};

const toOption = <TEntity extends { id: string; name: string }>(
  type: CandidateOption["type"],
  entity: TEntity,
  confidence: number,
  subtitle?: string,
): CandidateOption => ({
  id: entity.id,
  type,
  label: entity.name,
  subtitle,
  confidence,
});

export class EntityResolutionService {
  constructor(private readonly apiCoreAdapter: GTApiCoreAdapter) {}

  private resolveSelectedEntity<TEntity extends { id: string; name: string }>(
    selectedOptionIds: string[] | undefined,
    entities: TEntity[],
  ): ResolvedEntity<TEntity> | undefined {
    const selectedId = selectedOptionIds?.find((candidateId) => entities.some((entity) => entity.id === candidateId));
    if (!selectedId) {
      return undefined;
    }

    const entity = entities.find((candidate) => candidate.id === selectedId);
    if (!entity) {
      return undefined;
    }

    return {
      id: entity.id,
      name: entity.name,
      confidence: 1,
      entity,
    };
  }

  private extractMetadataTexts(value: string | null | undefined): string[] {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return [];
    }

    const collected = new Set<string>([raw]);

    const visit = (node: unknown) => {
      if (typeof node === "string") {
        const normalized = node.trim();
        if (normalized) {
          collected.add(normalized);
        }
        return;
      }

      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      if (node && typeof node === "object") {
        Object.values(node).forEach(visit);
      }
    };

    try {
      visit(JSON.parse(raw));
    } catch (_error) {
      // Metadata is often a plain string; keep the raw value only.
    }

    return Array.from(collected);
  }

  private serviceSearchTexts(service: GTService): string[] {
    return [
      service.name,
      service.description ?? "",
      ...this.extractMetadataTexts(service.metadata),
    ].filter(Boolean);
  }

  private productSearchTexts(product: GTProduct): string[] {
    return [
      product.name,
      product.description ?? "",
      product.stockItem?.name ?? "",
      product.stockItem?.sku ?? "",
      product.stockItem?.barcode ?? "",
    ].filter(Boolean);
  }

  resolveService(
    hint: string | undefined,
    catalog: GTCatalogSnapshot,
    selectedOptionIds?: string[],
  ): EntityResolution<GTService> {
    const selected = this.resolveSelectedEntity(selectedOptionIds, catalog.services);
    if (selected) {
      return {
        state: "resolved",
        resolved: selected,
        options: [],
      };
    }

    const normalizedHint = String(hint ?? "").trim();
    if (!normalizedHint) {
      return { state: "missing", options: [] };
    }

    const result = pickBestEntityMatchByTexts(normalizedHint, catalog.services, (service) => this.serviceSearchTexts(service));
    if (result.match) {
      return {
        state: "resolved",
        resolved: {
          id: result.match.id,
          name: result.match.name,
          confidence: result.confidence,
          entity: result.match,
        },
        options: [],
      };
    }

    return {
      state: result.ambiguous ? "ambiguous" : "missing",
      options: result.candidates.map((candidate) =>
        toOption(
          "service",
          candidate.entity,
          candidate.score,
          candidate.entity.description ? normalizeForMatching(candidate.entity.description).slice(0, 80) : undefined,
        ),
      ),
    };
  }

  resolveProduct(
    hint: string | undefined,
    catalog: GTCatalogSnapshot,
    selectedOptionIds?: string[],
  ): EntityResolution<GTProduct> {
    const selected = this.resolveSelectedEntity(selectedOptionIds, catalog.products);
    if (selected) {
      return {
        state: "resolved",
        resolved: selected,
        options: [],
      };
    }

    const normalizedHint = String(hint ?? "").trim();
    if (!normalizedHint) {
      return { state: "missing", options: [] };
    }

    const result = pickBestEntityMatchByTexts(normalizedHint, catalog.products, (product) => this.productSearchTexts(product));
    if (result.match) {
      return {
        state: "resolved",
        resolved: {
          id: result.match.id,
          name: result.match.name,
          confidence: result.confidence,
          entity: result.match,
        },
        options: [],
      };
    }

    return {
      state: result.ambiguous ? "ambiguous" : "missing",
      options: result.candidates.map((candidate) =>
        toOption(
          "product",
          candidate.entity,
          candidate.score,
          candidate.entity.stockItem ? `Stock ${candidate.entity.stockItem.stock}` : undefined,
        ),
      ),
    };
  }

  resolvePractitioner(
    hint: string | undefined,
    practitioners: GTPractitioner[],
    selectedOptionIds?: string[],
  ): EntityResolution<GTPractitioner> {
    const selected = this.resolveSelectedEntity(selectedOptionIds, practitioners);
    if (selected) {
      return {
        state: "resolved",
        resolved: selected,
        options: [],
      };
    }

    const normalizedHint = String(hint ?? "").trim();
    if (!normalizedHint) {
      return { state: "missing", options: practitioners.slice(0, 5).map((entity) => toOption("practitioner", entity, 0.5)) };
    }

    const result = pickBestEntityMatch(normalizedHint, practitioners);
    if (result.match) {
      return {
        state: "resolved",
        resolved: {
          id: result.match.id,
          name: result.match.name,
          confidence: result.confidence,
          entity: result.match,
        },
        options: [],
      };
    }

    return {
      state: result.ambiguous ? "ambiguous" : "missing",
      options: result.candidates.map((candidate) => toOption("practitioner", candidate.entity, candidate.score)),
    };
  }

  async resolveMember(
    session: GTSessionContext,
    hint: string | undefined,
    selectedOptionIds?: string[],
  ): Promise<EntityResolution<GTMember>> {
    for (const selectedId of selectedOptionIds ?? []) {
      const selectedMember = await this.apiCoreAdapter.getMemberById(session, selectedId);
      if (selectedMember) {
        return {
          state: "resolved",
          resolved: {
            id: selectedMember.id,
            name: selectedMember.name,
            confidence: 1,
            entity: selectedMember,
          },
          options: [],
        };
      }
    }

    const normalizedHint = String(hint ?? "").trim();
    if (!normalizedHint) {
      return { state: "missing", options: [] };
    }

    const memberMap = new Map<string, GTMember>();
    const addMembers = (candidates: GTMember[]) => {
      candidates.forEach((member) => {
        memberMap.set(member.id, member);
      });
    };

    addMembers(await this.apiCoreAdapter.searchMembers(session, normalizedHint));

    const tokenTerms = normalizedHint
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);

    if (memberMap.size === 0 && tokenTerms.length > 1) {
      const fallbackResults = await Promise.all(
        Array.from(new Set(tokenTerms)).slice(0, 3).map((token) => this.apiCoreAdapter.searchMembers(session, token)),
      );
      fallbackResults.forEach(addMembers);
    }

    const members = Array.from(memberMap.values());
    const result = pickBestEntityMatch(normalizedHint, members);
    if (result.match) {
      return {
        state: "resolved",
        resolved: {
          id: result.match.id,
          name: result.match.name,
          confidence: result.confidence,
          entity: result.match,
        },
        options: [],
      };
    }

    return {
      state: result.ambiguous ? "ambiguous" : "missing",
      options: result.candidates.map((candidate) =>
        toOption("member", candidate.entity, candidate.score, candidate.entity.phoneNumber ?? undefined),
      ),
    };
  }
}
