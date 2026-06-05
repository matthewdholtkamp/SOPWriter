export type NormalizationResult = {
  text: string;
  changes: string[];
  warnings: string[];
};

const MOVE_REVIEW_PATTERN =
  /\b(?:room|suite|floor|wing|building|located|location|hallway|corridor|entrance|exit|extension|pager|phone|workflow|layout|service location)\b/i;

export function normalizeLegacyVerbiage(input: string): NormalizationResult {
  const changes: string[] = [];
  const warnings: string[] = [];
  let text = input;

  if (/General Leonard Wood Army Community Hospital/.test(text)) {
    text = text.replaceAll(
      "General Leonard Wood Army Community Hospital",
      "General Leonard Wood Community Hospital"
    );
    changes.push("Updated General Leonard Wood Army Community Hospital to General Leonard Wood Community Hospital.");
  }
  if (/\bGLWACH\b/.test(text)) {
    text = text.replace(/\bGLWACH\b/g, "GLWCH");
    changes.push("Updated GLWACH to GLWCH.");
  }
  if (/\bshall\b/i.test(text)) {
    warnings.push('Found "shall"; choose must, will, may, or can based on meaning.');
  }
  if (MOVE_REVIEW_PATTERN.test(text)) {
    warnings.push("Found location, room, phone, layout, or workflow language that needs move review.");
  }

  return { text, changes, warnings };
}

export function containsMoveSensitiveLanguage(text: string): boolean {
  return MOVE_REVIEW_PATTERN.test(text);
}
