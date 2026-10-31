// Pure planning for company-sheet imports: match each profile to an applicant
// of the job, read round outcomes, and work out the company pipeline status.
import {
  normalizeValueKey,
  POST_SELECTION_STATUSES,
  type InterviewOutcome,
  type PipelineStatus,
  type RoundType,
} from "@placement/shared";
import { cleanText, normalizeEmail, normalizeMobile } from "../../utils/normalize.js";
import type { CompanyMapping } from "./imports.validators.js";
import type { Action, PlanIssue, Severity, StagedRow } from "./internal-plan.js";
import type { SheetRow } from "./workbook.js";

export interface JobApplicant {
  applicationId: string;
  candidateId: string;
  candidateCode: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  internallyRejected: boolean;
  nomination: { id: string; pipelineStatus: PipelineStatus; outcomes: Map<string, InterviewOutcome> } | null;
}

export interface CompanyRowData {
  kind: "company";
  applicationId: string | null;
  candidateId: string | null;
  candidateName: string | null;
  matchedBy: "email" | "mobile" | "manual" | null;
  createNomination: boolean;
  rounds: { roundName: string; roundType: RoundType; outcome: InterviewOutcome }[];
  fromStatus: PipelineStatus | null;
  toStatus: PipelineStatus | null;
}

export interface CompanySummary {
  rows: number;
  matched: number;
  unmatched: number;
  newNominations: number;
  statusChanges: number;
  rounds: { name: string; roundType: RoundType; exists: boolean }[];
  byStatus: Partial<Record<PipelineStatus, number>>;
  issues: Record<Severity, number>;
}

type Reader = (sheet: string, headerRow: number) => { headers: string[]; rows: SheetRow[] };

const cellOf = (row: SheetRow, column: number | undefined) => (column === undefined ? null : cleanText(row.cells[column] ?? null, 500));

export const overrideKey = (sheet: string, rowNumber: number) => `${sheet}#${rowNumber}`;

/**
 * The status a row implies: the final-status column when it has one, else
 * rejected if any round rejected, else "in company process" because the
 * company has the profile.
 */
export function deriveStatus(final: PipelineStatus | null, outcomes: InterviewOutcome[]): PipelineStatus {
  if (final) return final;
  if (outcomes.includes("REJECTED")) return "REJECTED";
  if (outcomes.includes("ON_HOLD")) return "ON_HOLD";
  return "IN_PROCESS";
}

export function planCompanyImport(
  config: CompanyMapping,
  read: Reader,
  applicants: JobApplicant[],
  otherCandidates: { fullName: string; email: string | null; mobile: string | null }[],
  existingRounds: string[],
) {
  const byEmail = new Map<string, JobApplicant[]>();
  const byMobile = new Map<string, JobApplicant[]>();
  const byId = new Map(applicants.map((applicant) => [applicant.applicationId, applicant]));
  for (const applicant of applicants) {
    if (applicant.email) byEmail.set(applicant.email, [...(byEmail.get(applicant.email) ?? []), applicant]);
    if (applicant.mobile) byMobile.set(applicant.mobile, [...(byMobile.get(applicant.mobile) ?? []), applicant]);
  }
  const outsiders = new Set(otherCandidates.flatMap(({ email, mobile }) => [email, mobile].filter(Boolean) as string[]));

  const rows: StagedRow<CompanyRowData>[] = [];
  const usedApplications = new Map<string, string>();
  const roundNames = new Map<string, RoundType>();

  for (const tab of config.tabs) {
    for (const round of tab.rounds) if (!roundNames.has(round.roundName)) roundNames.set(round.roundName, round.roundType);
    const sheet = read(tab.sheet, tab.headerRow);
    for (const row of sheet.rows) {
      const issues: PlanIssue[] = [];
      const name = cellOf(row, tab.columns.fullName);
      const email = normalizeEmail(cellOf(row, tab.columns.email));
      const mobile = normalizeMobile(cellOf(row, tab.columns.mobile));

      // Match: a manual choice wins; otherwise email, then mobile.
      let applicant: JobApplicant | undefined;
      let matchedBy: CompanyRowData["matchedBy"] = null;
      const override = config.overrides[overrideKey(tab.sheet, row.rowNumber)];
      if (override) {
        applicant = byId.get(override);
        matchedBy = "manual";
        if (!applicant) issues.push({ severity: "ERROR", code: "INVALID_MATCH", message: "The applicant chosen for this row is no longer on this job." });
      } else {
        const viaEmail = email ? byEmail.get(email) ?? [] : [];
        const viaMobile = mobile ? byMobile.get(mobile) ?? [] : [];
        if (viaEmail.length > 1 || viaMobile.length > 1 || (viaEmail[0] && viaMobile[0] && viaEmail[0].applicationId !== viaMobile[0].applicationId)) {
          issues.push({ severity: "ERROR", code: "AMBIGUOUS_MATCH", message: "The email and mobile match different applicants. Choose the right one." });
        } else if (viaEmail[0]) {
          applicant = viaEmail[0];
          matchedBy = "email";
        } else if (viaMobile[0]) {
          applicant = viaMobile[0];
          matchedBy = "mobile";
        } else if ((email && outsiders.has(email)) || (mobile && outsiders.has(mobile))) {
          issues.push({ severity: "ERROR", code: "NOT_APPLIED", message: "This person is in the dashboard but has no application for this job. Add them to the job first, or choose the applicant." });
        } else {
          issues.push({ severity: "ERROR", code: "NO_MATCH", message: "No applicant of this job has this email or mobile. Choose the applicant, or leave the row out." });
        }
      }

      if (applicant) {
        const earlier = usedApplications.get(applicant.applicationId);
        if (earlier) issues.push({ severity: "ERROR", code: "DUPLICATE_PROFILE", message: `Same applicant as ${earlier}.` });
        else usedApplications.set(applicant.applicationId, `${tab.sheet} row ${row.rowNumber}`);
        if (applicant.internallyRejected && !applicant.nomination) {
          issues.push({ severity: "ERROR", code: "INTERNALLY_REJECTED", message: `${applicant.fullName} was rejected in internal screening and cannot be nominated.` });
        } else if (!applicant.nomination) {
          issues.push({ severity: "WARNING", code: "NOT_NOMINATED", message: `${applicant.fullName} is not nominated yet; approving nominates them, since the company has the profile.` });
        }
      }

      const rounds: CompanyRowData["rounds"] = [];
      for (const round of tab.rounds) {
        const raw = cellOf(row, round.column);
        if (!raw) continue;
        const meaning = config.roundValueMap[normalizeValueKey(raw)];
        if (!meaning) issues.push({ severity: "ERROR", code: "UNMAPPED_VALUE", message: `“${raw}” in ${round.roundName} has no meaning assigned.` });
        else if (meaning !== "IGNORE") rounds.push({ roundName: round.roundName, roundType: round.roundType, outcome: meaning });
      }
      let final: PipelineStatus | null = null;
      const rawFinal = cellOf(row, tab.finalStatusColumn);
      if (rawFinal) {
        const meaning = config.finalValueMap[normalizeValueKey(rawFinal)];
        if (!meaning) issues.push({ severity: "ERROR", code: "UNMAPPED_VALUE", message: `Final status “${rawFinal}” has no meaning assigned.` });
        else if (meaning !== "IGNORE") final = meaning;
      }

      const fromStatus = applicant?.nomination?.pipelineStatus ?? null;
      let toStatus: PipelineStatus | null = applicant ? deriveStatus(final, rounds.map(({ outcome }) => outcome)) : null;
      if (fromStatus && toStatus && POST_SELECTION_STATUSES.includes(fromStatus) && toStatus !== fromStatus) {
        issues.push({ severity: "INFO", code: "KEEP_RECORDED_STATUS", message: `Status stays “${fromStatus.toLowerCase().replace(/_/g, " ")}” as recorded by the PSM.` });
        toStatus = fromStatus;
      }

      const roundChanges = rounds.some(({ roundName, outcome }) => applicant?.nomination?.outcomes.get(roundName) !== outcome);
      const hasError = issues.some((issue) => issue.severity === "ERROR");
      const action: Action = hasError ? "SKIP"
        : !applicant?.nomination ? "CREATE"
          : roundChanges || toStatus !== fromStatus ? "UPDATE" : "NO_CHANGE";

      const raw: Record<string, string> = {};
      row.cells.forEach((value, index) => {
        if (value) raw[sheet.headers[index] || `#${index + 1}`] = value;
      });

      rows.push({
        role: "COMPANY_TAB",
        sheet: tab.sheet,
        headerRow: tab.headerRow,
        rowNumber: row.rowNumber,
        rowRef: email ?? mobile ?? name,
        raw,
        data: {
          kind: "company",
          applicationId: applicant?.applicationId ?? null,
          candidateId: applicant?.candidateId ?? null,
          candidateName: applicant?.fullName ?? name,
          matchedBy,
          createNomination: Boolean(applicant && !applicant.nomination),
          rounds,
          fromStatus,
          toStatus,
        },
        action,
        issues,
        included: !hasError,
      });
    }
  }

  const issues: Record<Severity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const issue of rows.flatMap((row) => row.issues)) issues[issue.severity]++;
  const byStatus: CompanySummary["byStatus"] = {};
  for (const row of rows) {
    if (row.included && row.data.toStatus) byStatus[row.data.toStatus] = (byStatus[row.data.toStatus] ?? 0) + 1;
  }
  const summary: CompanySummary = {
    rows: rows.length,
    matched: rows.filter((row) => row.data.applicationId).length,
    unmatched: rows.filter((row) => !row.data.applicationId).length,
    newNominations: rows.filter((row) => row.included && row.data.createNomination).length,
    statusChanges: rows.filter((row) => row.included && row.data.toStatus !== row.data.fromStatus).length,
    rounds: [...roundNames].map(([name, roundType]) => ({ name, roundType, exists: existingRounds.includes(name) })),
    byStatus,
    issues,
  };
  return { rows, summary };
}
