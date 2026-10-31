/** Display form: trimmed, inner whitespace collapsed. */
export function cleanSkillName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Matching key: case-insensitive, so "React" and "react" are one skill. */
export function normalizeSkillName(name: string): string {
  return cleanSkillName(name).toLowerCase();
}

/** Splits free-text tech stacks such as "SQL / Python, BI" into distinct skills. */
export function splitSkills(values: string[]): string[] {
  const seen = new Map<string, string>();
  for (const part of values.flatMap((value) => value.split(/[,/|;]+/))) {
    const name = cleanSkillName(part);
    if (name && !seen.has(normalizeSkillName(name))) {
      seen.set(normalizeSkillName(name), name);
    }
  }
  return [...seen.values()];
}
