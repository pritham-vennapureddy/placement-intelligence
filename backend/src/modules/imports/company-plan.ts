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
import { generatedCandidateCode, type Action, type PlanIssue, type Severity, type StagedRow } from "./internal-plan.js";
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

/** A student in the dashboard who has no application in this drive (not in the internal sheet's TA). */
export interface OtherCandidate {
  candidateId: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  /** From their latest application, else their product list; null when the dashboard does not know it. */
  product: { id: string; name: string } | null;
}

/** A student on the internal sheet's eligible / product tab (not in TA), keyed by mobile. */
export interface EligibleStudent {
  sheet: string;
  fullName: string | null;
  email: string | null;
  product: { id: string; name: string } | null;
  /** The product as written on the sheet, when it matches no product in the dashboard. */
  productText: string | null;
}

/** Where a student added from the company sheet was found. */
export type AddedFrom = "DASHBOARD" | "ELIGIBLE" | "NOT_IN_APPLICANTS";

export interface CompanyRowData {
  kind: "company";
  applicationId: string | null;
  candidateId: string | null;
  candidateName: string | null;
  matchedBy: "mobile" | "manual" | null;
  createNomination: boolean;
  /**
   * Shared to the company without being in the internal sheet: approving adds the
   * student to this drive (and creates the student first when the dashboard has none).
   */
  addToJob?: {
    candidateId: string | null;
    newCandidate: { candidateCode: string; fullName: string; email: string | null; mobile: string; college?: string | null; graduationYear?: number | null } | null;
    productId: string | null;
    /** Dashboard, the internal sheet's eligible tab, or neither (tagged "not in applicants"). */
    from?: AddedFrom;
    fromSheet?: string | null;
  } | null;
  rounds: { roundName: string; roundType: RoundType; outcome: InterviewOutcome }[];
  /** Company feedback / rejection reason from the optional reason column. */
  reason?: string | null;
  fromStatus: PipelineStatus | null;
  toStatus: PipelineStatus | null;
}

export interface CompanySummary {
  rows: number;
  matched: number;
  unmatched: number;
  newNominations: number;
  /** Not in the internal sheet: added to this drive from the company sheet (new students included). */
  addedToJob: number;
  newStudents: number;
  /** Added students found on the internal sheet's eligible tab, and those found nowhere. */
  fromEligible?: number;
  notInApplicants?: number;
  statusChanges: number;
  rounds: { name: string; roundType: RoundType; exists: boolean }[];
  byStatus: Partial<Record<PipelineStatus, number>>;
  issues: Record<Severity, number>;
}

type Reader = (sheet: string, headerRow: number) => { headers: string[]; rows: SheetRow[] };

const cellOf = (row: SheetRow, column: number | undefined) => (column === undefined ? null : cleanText(row.cells[column] ?? null, 500));
const UUID_VALUE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

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
  otherCandidates: OtherCandidate[],
  existingRounds: string[],
  eligible: ReadonlyMap<string, EligibleStudent> = new Map(),
) {
  const byMobile = new Map<string, JobApplicant[]>();
  const byId = new Map(applicants.map((applicant) => [applicant.applicationId, applicant]));
  for (const applicant of applicants) {
    const normalizedMobile = normalizeMobile(applicant.mobile);
    if (normalizedMobile) byMobile.set(normalizedMobile, [...(byMobile.get(normalizedMobile) ?? []), applicant]);
  }
  const outsiders = new Map<string, OtherCandidate[]>();
  for (const candidate of otherCandidates) {
    const normalizedMobile = normalizeMobile(candidate.mobile);
    if (normalizedMobile) outsiders.set(normalizedMobile, [...(outsiders.get(normalizedMobile) ?? []), candidate]);
  }
  const usedOutsiders = new Map<string, string>();

  const rows: StagedRow<CompanyRowData>[] = [];
  const usedApplications = new Map<string, string>();
  const roundNames = new Map<string, RoundType>();

  for (const tab of config.tabs) {
    for (const round of tab.rounds) if (!roundNames.has(round.roundName)) roundNames.set(round.roundName, round.roundType);
    const sheet = read(tab.sheet, tab.headerRow);
    // The company sheet's own college / year of graduation, kept on students it creates.
    const headerAt = (pattern: RegExp) => { const index = sheet.headers.findIndex((header) => pattern.test(header.trim().toLowerCase())); return index < 0 ? undefined : index; };
    const collegeColumn = headerAt(/college|university|institute/);
    const yearColumn = headerAt(/graduation year|year of graduation|pass ?out year|completion year/);
    const profileOf = (row: SheetRow) => {
      const year = cellOf(row, yearColumn)?.match(/\b(19|20)\d{2}\b/)?.[0];
      return { college: cellOf(row, collegeColumn), graduationYear: year ? Number(year) : null };
    };
    for (const row of sheet.rows) {
      const issues: PlanIssue[] = [];
      const name = cellOf(row, tab.columns.fullName);
      const email = normalizeEmail(cellOf(row, tab.columns.email));
      const rawMobile = cellOf(row, tab.columns.mobile);
      const mobile = rawMobile && !UUID_VALUE.test(rawMobile) ? normalizeMobile(rawMobile) : null;

      // Normalized mobile is the sole automatic identity key; manual row overrides remain explicit operator decisions.
      let applicant: JobApplicant | undefined;
      let matchedBy: CompanyRowData["matchedBy"] = null;
      let addToJob: CompanyRowData["addToJob"] = null;
      let outsiderName: string | null = null;
      const override = config.overrides[overrideKey(tab.sheet, row.rowNumber)];
      if (override) {
        applicant = byId.get(override);
        matchedBy = "manual";
        if (!applicant) issues.push({ severity: "ERROR", code: "INVALID_MATCH", message: "The applicant chosen for this row is no longer on this job." });
      } else {
        const viaMobile = mobile ? byMobile.get(mobile) ?? [] : [];
        if (viaMobile.length > 1) {
          issues.push({ severity: "ERROR", code: "AMBIGUOUS_MATCH", message: `Mobile number “${mobile}” matches multiple applicants. Make the mobile number unique before importing.` });
        } else if (viaMobile[0]) {
          applicant = viaMobile[0];
          matchedBy = "mobile";
        } else if (mobile && (outsiders.get(mobile)?.length ?? 0) > 1) {
          issues.push({ severity: "ERROR", code: "AMBIGUOUS_MATCH", message: `Mobile number “${mobile}” belongs to more than one student in the dashboard. Choose the applicant, or leave the row out.` });
        } else if (mobile && outsiders.get(mobile)?.[0]) {
          // In the dashboard (an earlier drive or the student profiles) but not in this drive's internal sheet.
          const candidate = outsiders.get(mobile)![0]!;
          const listed = eligible.get(mobile);
          // Product: the dashboard's, else the eligible tab's.
          const product = candidate.product ?? listed?.product ?? null;
          const productSource = candidate.product ? "from the dashboard" : listed?.product ? `from ${listed.sheet}` : null;
          matchedBy = "mobile";
          outsiderName = candidate.fullName;
          addToJob = { candidateId: candidate.candidateId, newCandidate: null, productId: product?.id ?? null, from: listed ? "ELIGIBLE" : "DASHBOARD", fromSheet: listed?.sheet ?? null };
          issues.push({
            severity: "WARNING",
            code: "NOT_IN_INTERNAL_SHEET",
            message: `${candidate.fullName} is not in this drive's internal sheet (TA)${listed ? ` but is on ${listed.sheet}` : ""}. Approving adds them to the job (product: ${product ? `${product.name}, ${productSource}` : "not known"}) and nominates them as direct to company.`,
          });
        } else if (mobile && eligible.get(mobile) && (name || eligible.get(mobile)!.fullName)) {
          // Not in the dashboard, but on the internal sheet's eligible tab: create them from that row.
          const listed = eligible.get(mobile)!;
          const fullName = name ?? listed.fullName!;
          const studentEmail = email ?? listed.email;
          outsiderName = fullName;
          addToJob = {
            candidateId: null,
            newCandidate: { candidateCode: generatedCandidateCode(studentEmail, mobile, fullName), fullName, email: studentEmail, mobile, ...profileOf(row) },
            productId: listed.product?.id ?? null,
            from: "ELIGIBLE",
            fromSheet: listed.sheet,
          };
          const product = listed.product?.name ?? (listed.productText ? `“${listed.productText}” matches no product, so not set` : "not known");
          issues.push({
            severity: "WARNING",
            code: "NEW_STUDENT",
            message: `${fullName} is not in TA or the dashboard, but is on ${listed.sheet} of the internal sheet. Approving creates the student (product: ${product}) and adds them to the job as direct to company.`,
          });
        } else if (mobile && name) {
          // Not in TA, the dashboard or the eligible tab: add them anyway, tagged "not in applicants".
          outsiderName = name;
          addToJob = {
            candidateId: null,
            newCandidate: { candidateCode: generatedCandidateCode(email, mobile, name), fullName: name, email, mobile, ...profileOf(row) },
            productId: null,
            from: "NOT_IN_APPLICANTS",
            fromSheet: null,
          };
          issues.push({
            severity: "WARNING",
            code: "NOT_IN_APPLICANTS",
            message: `${name} is not in the applicants (TA), the eligible list or the dashboard. Approving creates the student from the company sheet (product not known; set to Academy if their mobile is in the assessed pool), adds them to the job as direct to company and tags them “not in applicants”. Choose the applicant instead if they are here under another number.`,
          });
        } else {
          issues.push({ severity: "ERROR", code: "NO_MATCH", message: mobile
            ? "No applicant of this job has this mobile number, and the row has no name to add the student with. Choose the applicant, or leave the row out."
            : "This row has no mobile number. Choose the applicant, or leave the row out." });
        }
      }
      if (addToJob) {
        const key = addToJob.candidateId ?? addToJob.newCandidate!.candidateCode;
        const earlier = usedOutsiders.get(key);
        if (earlier) issues.push({ severity: "ERROR", code: "DUPLICATE_PROFILE", message: `Same student as ${earlier}.` });
        else usedOutsiders.set(key, `${tab.sheet} row ${row.rowNumber}`);
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

      const reason = cellOf(row, tab.reasonColumn);

      const fromStatus = applicant?.nomination?.pipelineStatus ?? null;
      let toStatus: PipelineStatus | null = applicant || addToJob ? deriveStatus(final, rounds.map(({ outcome }) => outcome)) : null;
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
          candidateId: applicant?.candidateId ?? addToJob?.candidateId ?? null,
          candidateName: applicant?.fullName ?? outsiderName ?? name,
          matchedBy,
          createNomination: Boolean((applicant && !applicant.nomination) || addToJob),
          addToJob,
          rounds,
          reason,
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
    matched: rows.filter((row) => row.data.applicationId || row.data.addToJob).length,
    unmatched: rows.filter((row) => !row.data.applicationId && !row.data.addToJob).length,
    addedToJob: rows.filter((row) => row.included && row.data.addToJob).length,
    newStudents: rows.filter((row) => row.included && row.data.addToJob?.newCandidate).length,
    fromEligible: rows.filter((row) => row.included && row.data.addToJob?.from === "ELIGIBLE").length,
    notInApplicants: rows.filter((row) => row.included && row.data.addToJob?.from === "NOT_IN_APPLICANTS").length,
    newNominations: rows.filter((row) => row.included && row.data.createNomination).length,
    statusChanges: rows.filter((row) => row.included && row.data.toStatus !== row.data.fromStatus).length,
    rounds: [...roundNames].map(([name, roundType]) => ({ name, roundType, exists: existingRounds.includes(name) })),
    byStatus,
    issues,
  };
  return { rows, summary };
}
