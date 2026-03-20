const unwrapMarkdownJson = (raw: string): string => {
  return String(raw ?? "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
};

export const extractJsonObject = (raw: string): string => {
  const text = unwrapMarkdownJson(raw);
  if (!text) {
    return "";
  }

  const firstBrace = text.indexOf("{");
  if (firstBrace < 0) {
    return "";
  }

  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, index + 1);
      }
    }
  }

  return "";
};

export const parseJsonObject = <T extends object>(raw: string): T | null => {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};
