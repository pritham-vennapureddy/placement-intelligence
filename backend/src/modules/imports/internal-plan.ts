// Pure planning for internal-sheet imports: turns sheet rows plus what already
// exists in the database into staged rows and data-quality issues. No database
// access here, so the rules are unit-tested directly.
import { createHash } from "node:crypto";
import { DECISION_STAGES, normalizeValueKey, STAGE_LABELS, type DecisionStage, type Priority, type StageOutcome } from "@placement/shared";
import {
  cleanText,
  isPlausibleMobile,
  isUrl,
  normalizeEmail,
  normalizeMobile,
  parseDate,
  parseNumber,
  parseYear,
} from "../../utils/normalize.js";
import type { SheetRow } from "./workbook.js";
import type { InternalMapping, StageSheetMapping } from "./imports.validators.js";

export type Severity = "ERROR" | "WARNING" | "INFO";
export type Action = "CREATE" | "UPDATE" | "NO_CHANGE" | "CONFLICT" | "SKIP";

export interface PlanIssue {
  severity: Severity;
  code: string;
  message: string;
}

export interface StagedRow<T> {
  role: string;
  sheet: string;
  headerRow: number;
  rowNumber: number;
  rowRef: string | null;
  raw: Record<string, string>;
  data: T;
  action: Action;
  issues: PlanIssue[];
  /** Rows with errors are never included; conflicts start excluded. */
  included: boolean;
}

export interface CandidateFields {
  fullName: string;
  email: string | null;
  mobile: string | null;
  gender: string | null;
  currentCity: string | null;
  state: string | null;
  college: string | null;
  degree: string | null;
  department: string | null;
  graduationYear: number | null;
  academicScore: number | null;
  resumeUrl: string | null;
}

export interface ApplicationRowData {
  kind: "application";
  candidateCode: string;
  candidate: CandidateFields;
  productId: string | null;
  productCategory: string | null;
  appliedAt: string | null;
  /** Existing candidate matched, if any. */
  candidateId: string | null;
  /** Blank fields on the existing candidate that this row fills in. */
  fill: Partial<CandidateFields> & { category?: string };
  createApplication: boolean;
}

export interface StageRowData {
  kind: "stage";
  stage: DecisionStage;
  candidateCode: string | null;
  outcome: StageOutcome | null;
  priority: Priority | null;
  techScore: number | null;
  commScore: number | null;
  rejectionReason: string | null;
  remarks: string | null;
}

export interface ExistingCandidate extends Partial<CandidateFields> {
  id: string;
  candidateCode: string;
  fullName: string;
  category: string | null;
}

export interface PlanContext {
  job: { id: string; jobId: string };
  products: { id: string; code: string; name: string; category: string }[];
  /** Candidates found in the database by any code / email / mobile in the file. */
  candidates: ExistingCandidate[];
  /** Applications already on this job request, by candidate ID. */
  applicationCandidateIds: Set<string>;
  /** Existing decisions on this job: candidateId → stage → outcome and source. */
  outcomes: Map<string, Map<DecisionStage, { outcome: StageOutcome; source: string; priority: string | null; techScore: number | null; commScore: number | null }>>;
  /** Candidates whose earlier import for this job is not in this file. */
  importedCandidateIds: Set<string>;
  /** Other job requests by HubSpot Job ID, for the "rows from another job" message. */
  jobLabels: Map<string, string>;
}

export interface InternalPlan {
  rows: StagedRow<ApplicationRowData | StageRowData>[];
  batchIssues: PlanIssue[];
  summary: InternalSummary;
}

export interface InternalSummary {
  applications: { total: number; newCandidates: number; newApplications: number; updated: number; unchanged: number; errors: number };
  stages: Partial<Record<DecisionStage, { mode: string; rows: number; selected: number; rejected: number; onHold: number; pending: number; other: number; errors: number; conflicts: number }>>;
  otherJobIds: { jobId: string; label: string | null; rows: number }[];
  missingFromSource: number;
  issues: Record<Severity, number>;
}

type Reader = (sheet: string, headerRow: number) => { headers: string[]; rows: SheetRow[] };

const lower = (value: string | null) => value?.toLowerCase() ?? null;

function rawOf(headers: string[], row: SheetRow): Record<string, string> {
  const raw: Record<string, string> = {};
  row.cells.forEach((cell, index) => {
    if (cell) raw[headers[index] || `#${index + 1}`] = cell;
  });
  return raw;
}

function cell(row: SheetRow, column: number | undefined): string | null {
  return column === undefined ? null : cleanText(row.cells[column] ?? null, 2000);
}

/** URL columns: prefer the cell's hyperlink when the shown text is not itself a link. */
function urlCell(row: SheetRow, column: number | undefined): string | null {
  if (column === undefined) return null;
  const text = row.cells[column] ?? "";
  if (isUrl(text)) return text.trim();
  const link = row.links[column];
  return link && isUrl(link) ? link : null;
}

/** Stable generated code for candidates a sheet gives no ID for. */
export function generatedCandidateCode(email: string | null, mobile: string | null, name: string): string {
  const basis = email ?? mobile ?? name.toLowerCase();
  return `GEN-${createHash("sha256").update(basis).digest("hex").slice(0, 12)}`;
}

export function parsePriority(value: string | null): Priority | null {
  const match = value?.match(/p?\s*([123])\b/i);
  return match ? (`P${match[1]}` as Priority) : null;
}

/** Collects every lookup key in the applications sheet so the caller can query existing candidates. */
export function collectApplicationKeys(config: InternalMapping, read: Reader) {
  const { columns } = config.applications;
  const { rows } = read(config.applications.sheet, config.applications.headerRow);
  const codes = new Set<string>();
  const emails = new Set<string>();
  const mobiles = new Set<string>();
  const jobIds = new Set<string>();
  for (const row of rows) {
    const jobId = lower(cell(row, columns.jobId));
    if (jobId) jobIds.add(jobId);
    const code = cell(row, columns.candidateId);
    const email = normalizeEmail(cell(row, columns.email));
    const mobile = normalizeMobile(cell(row, columns.mobile));
    if (code) codes.add(code);
    if (email) emails.add(email);
    if (mobile) mobiles.add(mobile);
  }
  return { codes: [...codes], emails: [...emails], mobiles: [...mobiles], jobIds: [...jobIds] };
}

class CandidateIndex {
  private byCode = new Map<string, ExistingCandidate>();
  private byEmail = new Map<string, ExistingCandidate[]>();
  private byMobile = new Map<string, ExistingCandidate[]>();

  constructor(candidates: ExistingCandidate[]) {
    for (const candidate of candidates) {
      this.byCode.set(candidate.candidateCode.toLowerCase(), candidate);
      if (candidate.email) this.push(this.byEmail, candidate.email, candidate);
      if (candidate.mobile) this.push(this.byMobile, candidate.mobile, candidate);
    }
  }

  private push(map: Map<string, ExistingCandidate[]>, key: string, candidate: ExistingCandidate) {
    const list = map.get(key) ?? [];
    list.push(candidate);
    map.set(key, list);
  }

  code(code: string | null) {
    return code ? this.byCode.get(code.toLowerCase()) : undefined;
  }

  email(email: string | null) {
    return email ? this.byEmail.get(email) ?? [] : [];
  }

  mobile(mobile: string | null) {
    return mobile ? this.byMobile.get(mobile) ?? [] : [];
  }
}

const FILLABLE: (keyof CandidateFields)[] = [
  "email", "mobile", "gender", "currentCity", "state", "college", "degree", "department", "graduationYear", "academicScore", "resumeUrl",
];

export function planInternalImport(config: InternalMapping, read: Reader, context: PlanContext): InternalPlan {
  const rows: StagedRow<ApplicationRowData | StageRowData>[] = [];
  const batchIssues: PlanIssue[] = [];
  const index = new CandidateIndex(context.candidates);
  const productsByKey = new Map<string, PlanContext["products"][number]>();
  for (const product of context.products) {
    productsByKey.set(product.code.toLowerCase(), product);
    productsByKey.set(product.name.toLowerCase(), product);
  }

  // Optional separate product lookup (e.g. an eligible-students tab).
  const productLookup = new Map<string, string>();
  if (config.productsLookup) {
    const lookup = config.productsLookup;
    for (const row of read(lookup.sheet, lookup.headerRow).rows) {
      const rawKey = cell(row, lookup.keyColumn);
      const key = lookup.keyType === "email" ? normalizeEmail(rawKey) : lookup.keyType === "mobile" ? normalizeMobile(rawKey) : lower(rawKey);
      const product = cell(row, lookup.productColumn);
      // Later rows win, matching how the sheets are maintained (latest product last).
      if (key && product) productLookup.set(key, product);
    }
  }

  // ── Applications (TA) ──
  const { columns } = config.applications;
  const sheet = read(config.applications.sheet, config.applications.headerRow);
  const seenCodes = new Set<string>();
  const batchByCode = new Map<string, string>();
  const batchByEmail = new Map<string, Set<string>>();
  const batchByMobile = new Map<string, Set<string>>();
  const otherJobs = new Map<string, number>();
  const candidateIdByCode = new Map<string, string | null>();

  for (const row of sheet.rows) {
    const issues: PlanIssue[] = [];
    const rawCode = cell(row, columns.candidateId);
    const fullName = cell(row, columns.fullName);
    const rawEmail = cell(row, columns.email);
    const email = normalizeEmail(rawEmail);
    const rawMobile = cell(row, columns.mobile);
    const mobile = normalizeMobile(rawMobile);
    const rowJobId = lower(cell(row, columns.jobId));

    if (!fullName) issues.push({ severity: "ERROR", code: "MISSING_NAME", message: "The candidate's name is empty." });
    if (!rawCode && !email && !mobile) {
      issues.push({ severity: "ERROR", code: "MISSING_IDENTIFIER", message: "No Candidate ID, valid email or mobile number to identify the candidate." });
    }
    if (rawEmail && !email) issues.push({ severity: "WARNING", code: "INVALID_EMAIL", message: `“${rawEmail}” is not a valid email; it will be left blank.` });
    if (rawMobile && !isPlausibleMobile(mobile)) issues.push({ severity: "WARNING", code: "INVALID_MOBILE", message: `“${rawMobile}” does not look like a 10-digit mobile number.` });
    if (rowJobId && rowJobId !== context.job.jobId) {
      otherJobs.set(rowJobId, (otherJobs.get(rowJobId) ?? 0) + 1);
      issues.push(
        config.acceptOtherJobIds
          ? { severity: "WARNING", code: "OTHER_JOB", message: "This row's Job ID belongs to a different job request; used because you chose to re-use it." }
          : { severity: "ERROR", code: "OTHER_JOB", message: "This row's Job ID belongs to a different job request." },
      );
    }

    // Match an existing candidate: by code, otherwise by email then mobile.
    let existing: ExistingCandidate | undefined;
    if (rawCode) {
      existing = index.code(rawCode);
      if (!existing) {
        const sameContact = [...index.email(email), ...index.mobile(mobile)].find((candidate) => candidate.candidateCode.toLowerCase() !== rawCode.toLowerCase());
        if (sameContact) {
          issues.push({
            severity: "WARNING",
            code: "POSSIBLE_DUPLICATE_PERSON",
            message: `Same email or mobile as candidate ${sameContact.candidateCode} (${sameContact.fullName}) but a different Candidate ID; added as a separate candidate.`,
          });
        }
      }
    } else {
      const byEmail = index.email(email);
      const byMobile = index.mobile(mobile);
      if (byEmail.length > 1 || byMobile.length > 1 || (byEmail[0] && byMobile[0] && byEmail[0].id !== byMobile[0].id)) {
        issues.push({ severity: "ERROR", code: "AMBIGUOUS_MATCH", message: "The email and mobile point to different existing candidates. Add a Candidate ID column or fix the sheet." });
      } else {
        existing = byEmail[0] ?? byMobile[0];
      }
    }

    const candidateCode = existing?.candidateCode ?? rawCode ?? generatedCandidateCode(email, mobile, fullName ?? "");
    const codeKey = candidateCode.toLowerCase();
    if (seenCodes.has(codeKey)) {
      issues.push({ severity: "ERROR", code: "DUPLICATE_IN_FILE", message: "This candidate already appears on an earlier row of this sheet." });
    }

    // Product: from the row, else from the lookup tab.
    const lookupKey = config.productsLookup
      ? config.productsLookup.keyType === "email" ? email : config.productsLookup.keyType === "mobile" ? mobile : lower(rawCode)
      : null;
    const rawProduct = cell(row, columns.product) ?? (lookupKey ? productLookup.get(lookupKey) ?? null : null);
    const product = rawProduct ? productsByKey.get(rawProduct.toLowerCase()) : undefined;
    if (rawProduct && !product) issues.push({ severity: "WARNING", code: "UNKNOWN_PRODUCT", message: `Product “${rawProduct}” is not in the product list; left blank.` });

    const academic = parseNumber(cell(row, columns.academicScore));
    const fields: CandidateFields = {
      fullName: fullName ?? "",
      email,
      mobile,
      gender: cell(row, columns.gender),
      currentCity: cell(row, columns.city),
      state: cell(row, columns.state),
      college: cell(row, columns.college),
      degree: cell(row, columns.degree),
      department: cell(row, columns.department),
      graduationYear: parseYear(cell(row, columns.graduationYear)),
      academicScore: academic !== null && academic >= 0 && academic <= 100 ? academic : null,
      resumeUrl: urlCell(row, columns.resumeUrl),
    };

    const fill: ApplicationRowData["fill"] = {};
    if (existing) {
      for (const key of FILLABLE) {
        const incoming = fields[key];
        const current = existing[key];
        if (incoming !== null && (current === null || current === undefined)) {
          (fill as Record<string, unknown>)[key] = incoming;
        } else if ((key === "email" || key === "mobile") && incoming !== null && current && String(current) !== String(incoming)) {
          issues.push({ severity: "INFO", code: "FIELD_DIFFERS", message: `The sheet's ${key} differs from the stored one; the stored value is kept.` });
        }
      }
      if (product && !existing.category) fill.category = product.category;
    }

    const hasError = issues.some((issue) => issue.severity === "ERROR");
    const createApplication = !(existing && context.applicationCandidateIds.has(existing.id));
    const action: Action = !existing ? "CREATE" : createApplication || Object.keys(fill).length > 0 ? (createApplication ? "CREATE" : "UPDATE") : "NO_CHANGE";

    if (!hasError) {
      seenCodes.add(codeKey);
      batchByCode.set(codeKey, candidateCode);
      if (email) (batchByEmail.get(email) ?? batchByEmail.set(email, new Set()).get(email)!).add(candidateCode);
      if (mobile) (batchByMobile.get(mobile) ?? batchByMobile.set(mobile, new Set()).get(mobile)!).add(candidateCode);
      candidateIdByCode.set(codeKey, existing?.id ?? null);
    }

    const appliedAt = parseDate(cell(row, columns.appliedAt));
    rows.push({
      role: "APPLICATIONS",
      sheet: config.applications.sheet,
      headerRow: config.applications.headerRow,
      rowNumber: row.rowNumber,
      rowRef: rawCode ?? email ?? mobile,
      raw: rawOf(sheet.headers, row),
      data: {
        kind: "application",
        candidateCode,
        candidate: fields,
        productId: product?.id ?? null,
        productCategory: product?.category ?? null,
        appliedAt: appliedAt?.toISOString() ?? null,
        candidateId: existing?.id ?? null,
        fill,
        createApplication,
      },
      action: hasError ? "SKIP" : action,
      issues,
      included: !hasError,
    });
  }

  for (const [jobId, count] of otherJobs) {
    const label = context.jobLabels.get(jobId) ?? null;
    batchIssues.push({
      severity: config.acceptOtherJobIds ? "WARNING" : "ERROR",
      code: "OTHER_JOB",
      message: `${count} row(s) carry Job ID ${jobId}${label ? ` (${label})` : " (not in the dashboard)"}, not this job's ${context.job.jobId}. ${config.acceptOtherJobIds ? "They are used because you chose to re-use them." : "Tick “re-use rows from another job” to include them."}`,
    });
  }

  // Applicants already on this job, for matching stage rows not in this file.
  const existingByKey = { code: new Map<string, string>(), email: new Map<string, Set<string>>(), mobile: new Map<string, Set<string>>() };
  for (const candidate of context.candidates) {
    if (!context.applicationCandidateIds.has(candidate.id)) continue;
    existingByKey.code.set(candidate.candidateCode.toLowerCase(), candidate.candidateCode);
    if (candidate.email) (existingByKey.email.get(candidate.email) ?? existingByKey.email.set(candidate.email, new Set()).get(candidate.email)!).add(candidate.candidateCode);
    if (candidate.mobile) (existingByKey.mobile.get(candidate.mobile) ?? existingByKey.mobile.set(candidate.mobile, new Set()).get(candidate.mobile)!).add(candidate.candidateCode);
    candidateIdByCode.set(candidate.candidateCode.toLowerCase(), candidate.id);
  }

  const resolveApplicant = (mapping: StageSheetMapping, row: SheetRow): { code: string | null; issue?: PlanIssue } => {
    const raw = cell(row, mapping.matchColumn);
    if (!raw) return { code: null, issue: { severity: "ERROR", code: "MISSING_MATCH_VALUE", message: "The column used to find the applicant is empty." } };
    let matches: Set<string> | undefined;
    if (mapping.matchBy === "candidateId") {
      const code = batchByCode.get(raw.toLowerCase()) ?? existingByKey.code.get(raw.toLowerCase());
      matches = code ? new Set([code]) : undefined;
    } else {
      const key = mapping.matchBy === "email" ? normalizeEmail(raw) : normalizeMobile(raw);
      if (key) {
        matches = new Set([
          ...((mapping.matchBy === "email" ? batchByEmail : batchByMobile).get(key) ?? []),
          ...((mapping.matchBy === "email" ? existingByKey.email : existingByKey.mobile).get(key) ?? []),
        ]);
      }
    }
    if (!matches || matches.size === 0) {
      return { code: null, issue: { severity: "ERROR", code: "NOT_AN_APPLICANT", message: `“${raw}” does not match any applicant of this job.` } };
    }
    if (matches.size > 1) {
      return { code: null, issue: { severity: "ERROR", code: "AMBIGUOUS_MATCH", message: `“${raw}” matches more than one applicant.` } };
    }
    return { code: [...matches][0]! };
  };

  // ── Stage tabs ──
  const summaryStages: InternalSummary["stages"] = {};
  const decided = new Map<string, Map<DecisionStage, StageOutcome>>();

  for (const stage of DECISION_STAGES) {
    const mapping = config.stages[stage];
    if (mapping.mode !== "SHEET") {
      summaryStages[stage] = { mode: mapping.mode, rows: 0, selected: 0, rejected: 0, onHold: 0, pending: 0, other: 0, errors: 0, conflicts: 0 };
      continue;
    }
    const stats = { mode: "SHEET", rows: 0, selected: 0, rejected: 0, onHold: 0, pending: 0, other: 0, errors: 0, conflicts: 0 };
    const tab = read(mapping.sheet, mapping.headerRow);
    const seen = new Set<string>();
    for (const row of tab.rows) {
      stats.rows++;
      const issues: PlanIssue[] = [];
      const { code, issue } = resolveApplicant(mapping, row);
      if (issue) issues.push(issue);

      let outcome: StageOutcome | null = "SELECTED";
      if (mapping.decisionColumn !== undefined) {
        const rawDecision = cell(row, mapping.decisionColumn);
        const key = rawDecision ? normalizeValueKey(rawDecision) : "";
        outcome = key ? mapping.valueMap[key] ?? null : "PENDING";
        if (!outcome) issues.push({ severity: "ERROR", code: "UNMAPPED_VALUE", message: `The decision “${rawDecision}” has no meaning assigned.` });
      }

      const scores = [mapping.techScoreColumn, mapping.commScoreColumn].map((column) => {
        const value = parseNumber(cell(row, column));
        return value !== null && value >= 0 && value <= 10 ? value : null;
      });

      if (code) {
        const key = code.toLowerCase();
        if (seen.has(key)) issues.push({ severity: "ERROR", code: "DUPLICATE_IN_STAGE", message: "This applicant is listed more than once in this stage." });
        seen.add(key);
      }

      const data: StageRowData = {
        kind: "stage",
        stage,
        candidateCode: code,
        outcome,
        priority: parsePriority(cell(row, mapping.priorityColumn)),
        techScore: scores[0] ?? null,
        commScore: scores[1] ?? null,
        rejectionReason: cell(row, mapping.reasonColumn),
        remarks: cell(row, mapping.remarksColumn),
      };

      let action: Action = "CREATE";
      const candidateId = code ? candidateIdByCode.get(code.toLowerCase()) ?? null : null;
      const previous = candidateId ? context.outcomes.get(candidateId)?.get(stage) : undefined;
      if (previous && outcome) {
        const same = previous.outcome === outcome && previous.priority === data.priority
          && previous.techScore === data.techScore && previous.commScore === data.commScore;
        if (same) {
          action = "NO_CHANGE";
        } else if (previous.source === "MANUAL") {
          action = "CONFLICT";
          stats.conflicts++;
          issues.push({
            severity: "WARNING",
            code: "MANUAL_DECISION_DIFFERS",
            message: `A PSM recorded “${previous.outcome.toLowerCase().replace("_", " ")}” by hand; the sheet says “${outcome.toLowerCase().replace("_", " ")}”. ${config.overwriteManualDecisions ? "The sheet will replace it." : "Kept unless you include this row."}`,
          });
        } else {
          action = "UPDATE";
        }
      }

      const hasError = issues.some((entry) => entry.severity === "ERROR");
      if (hasError) stats.errors++;
      else if (code && outcome) {
        const counter = outcome === "SELECTED" ? "selected" : outcome === "REJECTED" ? "rejected" : outcome === "ON_HOLD" ? "onHold" : outcome === "PENDING" ? "pending" : "other";
        stats[counter]++;
        const perCandidate = decided.get(code.toLowerCase()) ?? new Map<DecisionStage, StageOutcome>();
        perCandidate.set(stage, outcome);
        decided.set(code.toLowerCase(), perCandidate);
      }

      rows.push({
        role: stage,
        sheet: mapping.sheet,
        headerRow: mapping.headerRow,
        rowNumber: row.rowNumber,
        rowRef: cell(row, mapping.matchColumn),
        raw: rawOf(tab.headers, row),
        data,
        action: hasError ? "SKIP" : action,
        issues,
        included: !hasError && (action !== "CONFLICT" || config.overwriteManualDecisions),
      });
    }
    summaryStages[stage] = stats;
  }

  // Selected at a stage after being rejected at an earlier one: allowed, but worth a look.
  for (const row of rows) {
    if (row.data.kind !== "stage" || !row.included || row.data.outcome !== "SELECTED" || !row.data.candidateCode) continue;
    const code = row.data.candidateCode.toLowerCase();
    const candidateId = candidateIdByCode.get(code);
    const earlier = DECISION_STAGES.slice(0, DECISION_STAGES.indexOf(row.data.stage));
    const rejectedAt = earlier.find((stage) =>
      decided.get(code)?.get(stage) === "REJECTED"
      || (!decided.get(code)?.has(stage) && candidateId && context.outcomes.get(candidateId)?.get(stage)?.outcome === "REJECTED"));
    if (rejectedAt) {
      row.issues.push({
        severity: "WARNING",
        code: "STAGE_ORDER",
        message: `Selected here but rejected at ${STAGE_LABELS[rejectedAt].code} (${STAGE_LABELS[rejectedAt].label}).`,
      });
    }
  }

  // Earlier imports' applicants that this file no longer lists are kept, never deleted.
  const inFile = new Set(rows.flatMap((row) => (row.data.kind === "application" && row.data.candidateId ? [row.data.candidateId] : [])));
  const missing = [...context.importedCandidateIds].filter((id) => !inFile.has(id)).length;
  if (missing > 0) {
    batchIssues.push({
      severity: "INFO",
      code: "MISSING_FROM_SOURCE",
      message: `${missing} applicant(s) imported earlier for this job are not in this file. They are kept; nothing is deleted.`,
    });
  }

  const appRows = rows.filter((row) => row.role === "APPLICATIONS") as StagedRow<ApplicationRowData>[];
  const issues: Record<Severity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const issue of [...batchIssues, ...rows.flatMap((row) => row.issues)]) issues[issue.severity]++;

  return {
    rows,
    batchIssues,
    summary: {
      applications: {
        total: appRows.length,
        newCandidates: appRows.filter((row) => row.included && !row.data.candidateId).length,
        newApplications: appRows.filter((row) => row.included && row.data.createApplication).length,
        updated: appRows.filter((row) => row.included && row.action === "UPDATE").length,
        unchanged: appRows.filter((row) => row.action === "NO_CHANGE").length,
        errors: appRows.filter((row) => !row.included).length,
      },
      stages: summaryStages,
      otherJobIds: [...otherJobs].map(([jobId, count]) => ({ jobId, label: context.jobLabels.get(jobId) ?? null, rows: count })),
      missingFromSource: missing,
      issues,
    },
  };
}
