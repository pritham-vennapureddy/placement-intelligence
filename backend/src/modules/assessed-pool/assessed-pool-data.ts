import type { SheetRow } from "../imports/workbook.js";

export type AssessedProcessType = "OLD" | "NEW" | "UNKNOWN";

export type CompetencyAssessment = {
  code: string;
  title: string;
  score: number | null;
  verdictBand: string | null;
  clearanceStatus: string | null;
  level: string | null;
};

export const COMPETENCY_TITLES: Record<string, string> = {
  C1: "Programming with Problem Solving (DSA)",
  C2: "Frontend Development",
  C3: "Software Engineering Fundamentals",
  C4: "Backend Development",
  C5: "System Design",
  C6: "Aptitude & Professional Skills",
  C7: "Generative AI Engineering",
};

export function processTypeForSheet(sheetTitle: string): AssessedProcessType {
  const normalized = sheetTitle.replace(/[\s_-]+/g, " ").trim().toLowerCase();
  if (normalized.includes("old process")) return "OLD";
  if (normalized === "offline pool main") return "NEW";
  return "UNKNOWN";
}

export function isCompetencyPoolSheet(sheetTitle: string): boolean {
  return sheetTitle.trim().toLowerCase() === "competency pool main";
}

export function groupRowsByMobile<T extends { mobile: string; row: SheetRow }>(
  rows: T[],
): { rowsByMobile: Map<string, SheetRow[]>; mergedDuplicateMobile: number } {
  const rowsByMobile = new Map<string, SheetRow[]>();
  for (const { mobile, row } of rows) {
    const group = rowsByMobile.get(mobile) ?? [];
    group.push(row);
    rowsByMobile.set(mobile, group);
  }
  return {
    rowsByMobile,
    mergedDuplicateMobile: rows.length - rowsByMobile.size,
  };
}

export function competencyHeaderInfo(rows: SheetRow[]): { headerRow: number; headers: string[] } | null {
  for (let index = 0; index < rows.length - 1; index += 1) {
    const groupRow = rows[index]!;
    const metricRow = rows[index + 1]!;
    const competencyGroups = groupRow.cells.filter((cell) => /^C[1-7]\b/i.test(cell.trim()));
    const metricLabels = metricRow.cells.filter((cell) =>
      /overall score|verdict band|clearance status|\blevels?\b/i.test(cell.trim()),
    );
    if (competencyGroups.length < 2 || metricLabels.length < 4) continue;

    let activeGroup: string | null = null;
    const headers = Array.from({ length: Math.max(groupRow.cells.length, metricRow.cells.length) }, (_, column) => {
      const groupHeader = groupRow.cells[column]?.trim() ?? "";
      const metricHeader = metricRow.cells[column]?.trim() ?? "";
      if (/^C[1-7]\b/i.test(groupHeader)) {
        activeGroup = groupHeader;
      } else if (groupHeader) {
        activeGroup = null;
      }

      if (metricHeader) return activeGroup ? `${activeGroup} - ${metricHeader}` : metricHeader;
      return groupHeader;
    });

    return { headerRow: metricRow.rowNumber, headers };
  }
  return null;
}

export function sourceNameForRow(headers: string[], cells: string[]): string | null {
  const column = headers.findIndex((header) => /\b(?:(?:student|candidate)\s+)?name\b/i.test(header.trim()));
  return column < 0 ? null : cells[column]?.trim() || null;
}

export function competenciesForRow(headers: string[], cells: string[]): CompetencyAssessment[] {
  return Object.entries(COMPETENCY_TITLES).flatMap(([code, title]) => {
    const valueFor = (pattern: RegExp): string | null => {
      const column = headers.findIndex((header) =>
        new RegExp(`\\b${code}\\b`, "i").test(header) && pattern.test(header),
      );
      return column < 0 ? null : cells[column]?.trim() || null;
    };
    const scoreText = valueFor(/overall score/i);
    const parsedScore = scoreText === null ? Number.NaN : Number(scoreText.replace(/,/g, ""));
    const assessment: CompetencyAssessment = {
      code,
      title,
      score: Number.isFinite(parsedScore) && parsedScore >= 0 && parsedScore <= 100 ? parsedScore : null,
      verdictBand: valueFor(/verdict band/i),
      clearanceStatus: valueFor(/clearance status/i),
      level: valueFor(/\blevels?\b/i),
    };
    return assessment.score !== null || assessment.verdictBand !== null ||
      assessment.clearanceStatus !== null || assessment.level !== null
      ? [assessment]
      : [];
  });
}

export function competencyLevelForRow(
  headers: string[],
  cells: string[],
  sheetTitle: string,
  mappedColumn?: number,
): string | null {
  const competencyColumn = headers.findIndex((header) =>
    /\bcompetenc(?:y|ies)\b(?!.*\b(?:status|remarks?)\b)(?:.*\b(?:level|tier|class|group|category)\b)?/i.test(header.trim()),
  );
  const genericLevelColumn = isCompetencyPoolSheet(sheetTitle)
    ? headers.findIndex((header) => /\b(?:level|tier|class|group|category)\b/i.test(header.trim()) && !/\bstatus|remarks?\b/i.test(header.trim()))
    : -1;
  const column = mappedColumn ?? (competencyColumn >= 0 ? competencyColumn : genericLevelColumn);
  if (column < 0) return null;
  const value = cells[column]?.trim() ?? "";
  return /^c\d+$/i.test(value) ? value.toUpperCase() : null;
}

export function rawRowData(sheetTitle: string, headers: string[], row: SheetRow) {
  const columnCount = Math.max(headers.length, row.cells.length, row.links.length);
  return {
    [sheetTitle]: {
      rowNumber: row.rowNumber,
      columns: Array.from({ length: columnCount }, (_, column) => ({
        column: column + 1,
        header: headers[column] ?? "",
        value: row.cells[column] ?? "",
        ...(row.links[column] ? { link: row.links[column] } : {}),
      })),
      ...(isCompetencyPoolSheet(sheetTitle) ? { competencies: competenciesForRow(headers, row.cells) } : {}),
    },
  };
}

export function autoAssessedPoolMapping(headers: string[]): Record<string, number> | null {
  const normalized = headers.map((header) => header.replace(/[\s_-]+/g, " ").trim().toLowerCase());
  const first = (pattern: RegExp) => normalized.findIndex((header) => pattern.test(header));
  const mobile = first(/\bmobile\b|\bphone\b/);
  if (mobile < 0) return null;

  const mapping: Record<string, number> = { mobile };
  const optional: [string, RegExp][] = [
    ["sourceUserId", /\buuid\b|\buid\b|\buser id\b/],
    ["bucketTier", /^(?:bucket(?: tier)?(?: \(.*\))?|tier(?: \(.*\))?)$/],
    ["tr1Status", /\btr\s*1\b.*\bstatus\b/],
    ["tr2Status", /\btr\s*2\b.*\bstatus\b/],
    ["competencyStatus", /\bcompetenc(?:y|ies)\b.*\bstatus\b/],
    ["competencyLevel", /\bcompetenc(?:y|ies)\b(?!.*\bstatus\b)(?:.*\b(?:level|tier|class|group|category)\b)?/],
    ["spReason", /\bsp\b.*\breason\b|\bfinal\b.*\bshortlist\b.*\breason\b/],
  ];
  for (const [field, pattern] of optional) {
    const column = first(pattern);
    if (column >= 0) mapping[field] = column;
  }
  return mapping;
}
