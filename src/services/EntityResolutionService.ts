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
import { pickBestEntityMatch } from "../utils/matching.js";

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

  resolveService(hint: string | undefined, catalog: GTCatalogSnapshot): EntityResolution<GTService> {
    const normalizedHint = String(hint ?? "").trim();
    if (!normalizedHint) {
      return { state: "missing", options: [] };
    }

    const result = pickBestEntityMatch(normalizedHint, catalog.services);
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
      options: result.candidates.map((candidate) => toOption("service", candidate.entity, candidate.score)),
    };
  }

  resolveProduct(hint: string | undefined, catalog: GTCatalogSnapshot): EntityResolution<GTProduct> {
    const normalizedHint = String(hint ?? "").trim();
    if (!normalizedHint) {
      return { state: "missing", options: [] };
    }

    const result = pickBestEntityMatch(normalizedHint, catalog.products);
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
  ): EntityResolution<GTPractitioner> {
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

  async resolveMember(session: GTSessionContext, hint: string | undefined): Promise<EntityResolution<GTMember>> {
    const normalizedHint = String(hint ?? "").trim();
    if (!normalizedHint) {
      return { state: "missing", options: [] };
    }

    const members = await this.apiCoreAdapter.searchMembers(session, normalizedHint);
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
