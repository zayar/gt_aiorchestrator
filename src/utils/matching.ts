const normalize = (value: string): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "the",
  "of",
  "to",
  "with",
  "what",
  "go",
  "products",
  "product",
  "service",
  "services",
  "please",
  "show",
  "book",
  "booking",
  "appointment",
  "create",
  "sale",
  "quote",
  "check",
  "stock",
  "summary",
  "summarize",
]);

const tokenize = (value: string, removeStopwords = false): string[] =>
  normalize(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !removeStopwords || !STOPWORDS.has(token));

const levenshtein = (left: string, right: string): number => {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = new Array(right.length + 1).fill(0).map((_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
};

const tokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const significantTokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(tokenize(left, true));
  const rightTokens = new Set(tokenize(right, true));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const containsAllSignificantTokens = (left: string, right: string): boolean => {
  const leftTokens = tokenize(left, true);
  const rightTokens = new Set(tokenize(right, true));
  return leftTokens.length > 0 && leftTokens.every((token) => rightTokens.has(token));
};

export const similarity = (left: string, right: string): number => {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const compactLeft = normalizedLeft.replace(/\s+/g, "");
  const compactRight = normalizedRight.replace(/\s+/g, "");
  const maxLength = Math.max(compactLeft.length, compactRight.length, 1);
  const editScore = 1 - levenshtein(compactLeft, compactRight) / maxLength;
  const containsScore =
    normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? 0.85 : 0;
  const significantContainsScore = containsAllSignificantTokens(normalizedLeft, normalizedRight) ? 0.94 : 0;
  const significantOverlapScore = significantTokenOverlap(normalizedLeft, normalizedRight) * 0.97;

  return Math.max(
    editScore * 0.8,
    tokenOverlap(normalizedLeft, normalizedRight) * 0.9,
    containsScore,
    significantContainsScore,
    significantOverlapScore,
  );
};

export type RankedMatch<TEntity> = {
  entity: TEntity;
  score: number;
};

export const rankEntityMatchesByName = <TEntity extends { name: string }>(
  hint: string,
  entities: TEntity[],
): RankedMatch<TEntity>[] => {
  const normalizedHint = normalize(hint);
  if (!normalizedHint) {
    return [];
  }

  return entities
    .map((entity) => ({
      entity,
      score: similarity(normalizedHint, entity.name),
    }))
    .sort((left, right) => right.score - left.score);
};

export const rankEntityMatchesByTexts = <TEntity>(
  hint: string,
  entities: TEntity[],
  getTexts: (entity: TEntity) => string[],
): RankedMatch<TEntity>[] => {
  const normalizedHint = normalize(hint);
  if (!normalizedHint) {
    return [];
  }

  return entities
    .map((entity) => ({
      entity,
      score: getTexts(entity)
        .filter(Boolean)
        .reduce((best, text) => Math.max(best, similarity(normalizedHint, text)), 0),
    }))
    .sort((left, right) => right.score - left.score);
};

export const pickBestEntityMatch = <TEntity extends { name: string }>(
  hint: string,
  entities: TEntity[],
  threshold = 0.58,
): {
  match: TEntity | null;
  confidence: number;
  ambiguous: boolean;
  candidates: RankedMatch<TEntity>[];
} => {
  const ranked = rankEntityMatchesByName(hint, entities);
  const top = ranked[0];
  const second = ranked[1];

  if (!top || top.score < threshold) {
    return {
      match: null,
      confidence: top?.score ?? 0,
      ambiguous: false,
      candidates: ranked.slice(0, 5),
    };
  }

  const ambiguous = Boolean(second && second.score >= threshold && top.score - second.score < 0.08);
  return {
    match: ambiguous ? null : top.entity,
    confidence: top.score,
    ambiguous,
    candidates: ranked.slice(0, 5),
  };
};

export const pickBestEntityMatchByTexts = <TEntity>(
  hint: string,
  entities: TEntity[],
  getTexts: (entity: TEntity) => string[],
  threshold = 0.58,
): {
  match: TEntity | null;
  confidence: number;
  ambiguous: boolean;
  candidates: RankedMatch<TEntity>[];
} => {
  const ranked = rankEntityMatchesByTexts(hint, entities, getTexts);
  const top = ranked[0];
  const second = ranked[1];

  if (!top || top.score < threshold) {
    return {
      match: null,
      confidence: top?.score ?? 0,
      ambiguous: false,
      candidates: ranked.slice(0, 5),
    };
  }

  const ambiguous = Boolean(second && second.score >= threshold && top.score - second.score < 0.08);
  return {
    match: ambiguous ? null : top.entity,
    confidence: top.score,
    ambiguous,
    candidates: ranked.slice(0, 5),
  };
};

export const normalizeForMatching = normalize;
