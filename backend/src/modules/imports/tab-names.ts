/**
 * Recruitment-tab names. A job's first batch usually uses TA, RS, SC, AS and
 * SP; later batches of the same internal sheet add a number, e.g. "TA-1",
 * "RS 2", "SC_3" or "SP (2)". The PSM confirms the tabs for each batch on the
 * mapping screen; these helpers only make the first suggestion.
 */
export type RecruitmentCode = "TA" | "RS" | "SC" | "AS" | "SP";

const SUFFIX = String.raw`(?:[\s_\-.#]*\(?(\d+)\)?)?`;

/** "TA", "TA-1", "ta 2", "TA_3", "TA (2)" → true for code TA. */
export function isRecruitmentTab(name: string, code?: RecruitmentCode): boolean {
  const codes = code ?? "ta|rs|sc|as|sp";
  return new RegExp(`^(?:${codes})${SUFFIX}$`, "i").test(name.trim());
}

/** The tab's batch number: 0 for a plain "TA", 1 for "TA-1", and so on. */
export function tabNumber(name: string): number {
  const match = name.trim().match(new RegExp(`^[a-z]+${SUFFIX}$`, "i"));
  return match?.[1] ? Number(match[1]) : 0;
}

/**
 * The tab for `code` that no other batch of this job has used, lowest number
 * first, so batch 1 gets "TA" and the next batch "TA-1".
 */
export function suggestRecruitmentTab<T extends { name: string }>(sheets: T[], code: RecruitmentCode, usedSheets: ReadonlySet<string>): T | undefined {
  return sheets
    .filter(({ name }) => isRecruitmentTab(name, code) && !usedSheets.has(name))
    .sort((a, b) => tabNumber(a.name) - tabNumber(b.name))[0];
}

/** Sheets named by a saved internal mapping: the applications tab and each stage tab. */
export function sheetsInMapping(mapping: unknown): string[] {
  const value = mapping as { applications?: { sheet?: string }; stages?: Record<string, { mode?: string; sheet?: string }> } | null;
  return [
    value?.applications?.sheet,
    ...Object.values(value?.stages ?? {}).map((stage) => (stage?.mode === "SHEET" ? stage.sheet : undefined)),
  ].filter((sheet): sheet is string => Boolean(sheet));
}
