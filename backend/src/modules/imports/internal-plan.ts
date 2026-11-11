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
import { isRecruitmentTab } from "./tab-names.js";
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
  resumeAssessment?: { analyzedAt: string | null; scores: Record<string, string>; skills: string[]; projects: string[]; details: Record<string, string> } | null;
  additionalProfiles?: { classification: string; sourceSheet: string; data: Record<string, string> }[];
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
  selectionBasis?: string | null;
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
  /** Candidates found in the database by normalized mobile number, plus applicants already on this job. */
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
  applications: { total: number; newCandidates: number; newApplications: number; updated: number; unchanged: number; errors: number; duplicates: number };
  stages: Partial<Record<DecisionStage, { mode: string; rows: number; selected: number; rejected: number; onHold: number; noShow: number; pending: number; other: number; errors: number; conflicts: number }>>;
  otherJobIds: { jobId: string; label: string | null; rows: number }[];
  missingFromSource: number;
  issues: Record<Severity, number>;
}

type Reader = (sheet: string, headerRow: number) => { headers: string[]; rows: SheetRow[] };

const lower = (value: string | null) => value?.toLowerCase() ?? null;
const UUID_VALUE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

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

/** Collect normalized mobile keys from the applications sheet for database lookup. */
export function collectApplicationKeys(config: InternalMapping, read: Reader) {
  const { columns } = config.applications;
  const { rows } = read(config.applications.sheet, config.applications.headerRow);
  const mobiles = new Set<string>();
  const jobIds = new Set<string>();
  for (const row of rows) {
    const jobId = lower(cell(row, columns.jobId));
    if (jobId) jobIds.add(jobId);
    const rawMobile = cell(row, columns.mobile);
    const mobile = rawMobile && !UUID_VALUE.test(rawMobile) ? normalizeMobile(rawMobile) : null;
    if (mobile) mobiles.add(mobile);
  }
  return { mobiles: [...mobiles], jobIds: [...jobIds] };
}

class CandidateIndex {
  private byMobile = new Map<string, ExistingCandidate[]>();

  constructor(candidates: ExistingCandidate[]) {
    for (const candidate of candidates) {
      const mobile = normalizeMobile(candidate.mobile);
      if (mobile) this.push(this.byMobile, mobile, candidate);
    }
  }

  private push(map: Map<string, ExistingCandidate[]>, key: string, candidate: ExistingCandidate) {
    const list = map.get(key) ?? [];
    list.push(candidate);
    map.set(key, list);
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
  const profileIssues: PlanIssue[] = [];
  /** Tab → number of its rows left out because their mobile is not unique. */
  const ambiguousProfileRows = new Map<string, number>();
  const countAmbiguous = (sheet: string, rowsLeftOut = 1) => ambiguousProfileRows.set(sheet, (ambiguousProfileRows.get(sheet) ?? 0) + rowsLeftOut);
  const index = new CandidateIndex(context.candidates);
  const productsByKey = new Map<string, PlanContext["products"][number]>();
  for (const product of context.products) {
    productsByKey.set(product.code.toLowerCase(), product);
    productsByKey.set(product.name.toLowerCase(), product);
  }

  // Optional separate product lookup (e.g. an eligible-students tab).
  const productLookup = new Map<string, string>();
  const ambiguousProductKeys = new Set<string>();
  if (config.productsLookup) {
    const lookup = config.productsLookup;
    for (const row of read(lookup.sheet, lookup.headerRow).rows) {
      const rawKey = cell(row, lookup.keyColumn);
      const key = rawKey && !UUID_VALUE.test(rawKey) ? normalizeMobile(rawKey) : null;
      const product = cell(row, lookup.productColumn);
      if (!key || !product || ambiguousProductKeys.has(key)) continue;
      const earlier = productLookup.get(key);
      if (earlier !== undefined) {
        // The same applicant listed twice with the same product is not a conflict.
        if (earlier.toLowerCase() !== product.toLowerCase()) {
          productLookup.delete(key);
          ambiguousProductKeys.add(key);
        }
      } else {
        productLookup.set(key, product);
      }
    }
  }

  // Identify shared mobile numbers among this job's known applicants before
  // using mobile to enrich any supplemental profile sheet.
  const applicantCodesByMobile = new Map<string, Set<string>>();
  const applicantFingerprint = (name: string | null, email: string | null, fallback: string) => {
    const normalizedName = name?.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedEmail = normalizeEmail(email);
    // Two rows count as one applicant only when both corroborating fields exist.
    return normalizedName && normalizedEmail ? `${normalizedName}|${normalizedEmail}` : fallback;
  };
  const applicationSheet = read(config.applications.sheet, config.applications.headerRow);
  // A TA tab with only mobile numbers cannot tell two people apart, and mobile is
  // the identity key: repeated mobiles there are one applicant listed twice.
  const applicationsHaveIdentityDetails = config.applications.columns.fullName !== undefined || config.applications.columns.email !== undefined;
  for (const row of applicationSheet.rows) {
    const rawMobile = cell(row, config.applications.columns.mobile);
    const mobile = rawMobile && !UUID_VALUE.test(rawMobile) ? normalizeMobile(rawMobile) : null;
    if (!mobile) continue;
    const fingerprint = applicantFingerprint(
      cell(row, config.applications.columns.fullName),
      cell(row, config.applications.columns.email),
      applicationsHaveIdentityDetails ? `source-row:${row.rowNumber}` : `mobile:${mobile}`,
    );
    (applicantCodesByMobile.get(mobile) ?? applicantCodesByMobile.set(mobile, new Set()).get(mobile)!).add(fingerprint);
  }
  for (const candidate of context.candidates) {
    if (!context.applicationCandidateIds.has(candidate.id)) continue;
    const mobile = normalizeMobile(candidate.mobile);
    if (!mobile) continue;
    const fingerprint = applicantFingerprint(candidate.fullName, candidate.email ?? null, candidate.candidateCode.toLowerCase());
    (applicantCodesByMobile.get(mobile) ?? applicantCodesByMobile.set(mobile, new Set()).get(mobile)!).add(fingerprint);
  }

  type ProfileData = NonNullable<ApplicationRowData["resumeAssessment"]>;
  type ProfileEntry = { candidateCode: string | null; fields: Partial<CandidateFields>; product?: string | undefined; resumeAssessment?: ProfileData | undefined; additionalProfiles: NonNullable<ApplicationRowData["additionalProfiles"]> };
  const profileByKey = new Map<string, ProfileEntry>();
  const ambiguousProfileKeys = new Set<string>();
  const ambiguousProfileSheetKeys = new Set<string>();
  const profileKey = (value: string | null) => {
    if (!value) return null;
    const normalized = UUID_VALUE.test(value) ? null : normalizeMobile(value);
    return normalized ? `mobile:${normalized}` : null;
  };
  for (const lookup of config.profileLookups) {
    const source = read(lookup.sheet, lookup.headerRow);
    const rowsByMobile = new Map<string, SheetRow[]>();
    for (const row of source.rows) {
      const rawMobile = cell(row, lookup.columns.mobile);
      const mobile = rawMobile && !UUID_VALUE.test(rawMobile) ? normalizeMobile(rawMobile) : null;
      if (mobile) (rowsByMobile.get(mobile) ?? rowsByMobile.set(mobile, []).get(mobile)!).push(row);
    }
    const collapsedRowsByMobile = new Map<string, number>();
    const ambiguousMobiles = new Set<string>();
    const timestampColumn = source.headers.findIndex((header) => /timestamp|submitted at/i.test(header));
    for (const [mobile, duplicateRows] of rowsByMobile) {
      if (duplicateRows.length < 2) continue;
      const identities = duplicateRows.map((row) => ({
        name: cell(row, lookup.columns.fullName)?.toLowerCase().replace(/\s+/g, " ").trim() ?? null,
        email: normalizeEmail(cell(row, lookup.columns.email)),
      }));
      const sameApplicant = identities.every(({ name, email }) => Boolean(name && email))
        && identities.every(({ name, email }) => name === identities[0]?.name && email === identities[0]?.email);
      if (!sameApplicant) {
        ambiguousMobiles.add(mobile);
        ambiguousProfileSheetKeys.add(`${lookup.sheet}:mobile:${mobile}`);
        countAmbiguous(lookup.sheet, duplicateRows.length);
        continue;
      }
      const latest = [...duplicateRows].sort((a, b) => {
        const aDate = timestampColumn >= 0 ? parseDate(a.cells[timestampColumn] ?? null)?.getTime() ?? 0 : 0;
        const bDate = timestampColumn >= 0 ? parseDate(b.cells[timestampColumn] ?? null)?.getTime() ?? 0 : 0;
        return bDate - aDate || b.rowNumber - a.rowNumber;
      })[0]!;
      collapsedRowsByMobile.set(mobile, latest.rowNumber);
      profileIssues.push({ severity: "WARNING", code: "DUPLICATE_PROFILE_COLLAPSED", message: `Repeated ${lookup.sheet} submissions for mobile ${mobile} have the same name and email; the latest response was kept.` });
    }
    for (const row of source.rows) {
      const candidateCode = null;
      const rawMobile = cell(row, lookup.columns.mobile);
      const normalizedMobile = rawMobile && !UUID_VALUE.test(rawMobile) ? normalizeMobile(rawMobile) : null;
      if (normalizedMobile && ambiguousMobiles.has(normalizedMobile)) continue;
      if (normalizedMobile && collapsedRowsByMobile.has(normalizedMobile) && collapsedRowsByMobile.get(normalizedMobile) !== row.rowNumber) continue;
      const keys = new Set([
        profileKey(rawMobile),
      ].filter((key): key is string => key !== null));
      for (const key of [...keys]) {
        if (!key.startsWith("mobile:")) continue;
        const possibleCodes = applicantCodesByMobile.get(key.slice("mobile:".length));
        if (possibleCodes && possibleCodes.size > 1) {
          keys.delete(key);
          ambiguousProfileKeys.add(key);
          countAmbiguous(lookup.sheet);
        }
      }
      if (keys.size === 0) continue;
      const parsedScore = parseNumber(cell(row, lookup.columns.academicScore));
      const fields: Partial<CandidateFields> = {
        ...(cell(row, lookup.columns.fullName) ? { fullName: cell(row, lookup.columns.fullName)! } : {}),
        ...(normalizeEmail(cell(row, lookup.columns.email)) ? { email: normalizeEmail(cell(row, lookup.columns.email))! } : {}),
        ...(normalizeMobile(cell(row, lookup.columns.mobile)) ? { mobile: normalizeMobile(cell(row, lookup.columns.mobile))! } : {}),
        ...(cell(row, lookup.columns.gender) ? { gender: cell(row, lookup.columns.gender)! } : {}),
        ...(cell(row, lookup.columns.city) ? { currentCity: cell(row, lookup.columns.city)! } : {}),
        ...(cell(row, lookup.columns.state) ? { state: cell(row, lookup.columns.state)! } : {}),
        ...(cell(row, lookup.columns.college) ? { college: cell(row, lookup.columns.college)! } : {}),
        ...(cell(row, lookup.columns.degree) ? { degree: cell(row, lookup.columns.degree)! } : {}),
        ...(cell(row, lookup.columns.department) ? { department: cell(row, lookup.columns.department)! } : {}),
        ...(parseYear(cell(row, lookup.columns.graduationYear)) !== null ? { graduationYear: parseYear(cell(row, lookup.columns.graduationYear))! } : {}),
        ...(parsedScore !== null ? { academicScore: parsedScore } : {}),
        ...(urlCell(row, lookup.columns.resumeUrl) ? { resumeUrl: urlCell(row, lookup.columns.resumeUrl)! } : {}),
      };
      const details = rawOf(source.headers, row);
      const scoreEntries = Object.entries(details).filter(([heading, value]) => /score|rating|verdict|clearance|level/i.test(heading) && parseNumber(value) !== null);
      const skills = Object.entries(details).filter(([heading, value]) => /skill/i.test(heading) && !/score|rating/i.test(heading) && value).map(([, value]) => value);
      const projects = Object.entries(details).filter(([heading, value]) => /project/i.test(heading) && value).map(([, value]) => value);
      const isTool = /^tool$/i.test(lookup.sheet.trim());
      const recruitmentTab = isRecruitmentTab(lookup.sheet);
      const classification = /applied|application/i.test(lookup.sheet) ? "APPLICATION"
        : /nxt\s*mock/i.test(lookup.sheet) ? "NXTMOCK"
        : /project/i.test(lookup.sheet) ? "PROJECT"
          : /screen/i.test(lookup.sheet) ? "SCREENING"
            : /resume|^tool$/i.test(lookup.sheet) ? "RESUME"
              : "OTHER";
      const profileProduct = cell(row, lookup.columns.product);
      const profileEntry: ProfileEntry = {
        candidateCode,
        fields,
        ...(profileProduct ? { product: profileProduct } : {}),
        ...(isTool ? { resumeAssessment: {
          analyzedAt: Object.entries(details).find(([heading]) => /analy[sz]ed|analysis date/i.test(heading))?.[1] ?? null,
          scores: Object.fromEntries(scoreEntries), skills, projects, details,
        } } : {}),
        additionalProfiles: recruitmentTab || lookup.sheet === config.applications.sheet ? [] : [{ classification, sourceSheet: lookup.sheet, data: details }],
      };
      for (const key of keys) {
        const existing = profileByKey.get(key);
        profileByKey.set(key, existing
          ? {
            candidateCode: existing.candidateCode ?? candidateCode,
            fields: { ...fields, ...existing.fields },
            product: existing.product ?? profileEntry.product,
            resumeAssessment: profileEntry.resumeAssessment ?? existing.resumeAssessment,
            additionalProfiles: [...existing.additionalProfiles, ...profileEntry.additionalProfiles],
          }
          : profileEntry);
      }
    }
  }

  const profileForRow = (row: SheetRow): ProfileEntry => {
    const rawMobile = cell(row, config.applications.columns.mobile);
    const keys = [profileKey(rawMobile)];
    let profile: ProfileEntry = { candidateCode: null, fields: {}, additionalProfiles: [] };
    for (const key of keys) {
      const match = key && !ambiguousProfileKeys.has(key) ? profileByKey.get(key) : undefined;
      if (match) {
        profile = {
          candidateCode: profile.candidateCode ?? match.candidateCode,
          fields: { ...match.fields, ...profile.fields },
          product: profile.product ?? match.product,
          resumeAssessment: profile.resumeAssessment ?? match.resumeAssessment,
          additionalProfiles: [...profile.additionalProfiles, ...match.additionalProfiles],
        };
      }
    }
    return profile;
  };

  // ── Applications (TA) ──
  const { columns } = config.applications;
  const sheet = read(config.applications.sheet, config.applications.headerRow);
  /** Candidate code → the first row it appeared on, with the name shown there. */
  const seenCodes = new Map<string, { rowNumber: number; name: string | null }>();
  /** Mobiles found on the product tab, and those marked External because they are not on it. */
  const productTabMatches = new Set<string>();
  const productTabExternal = new Set<string>();
  const batchByMobile = new Map<string, Set<string>>();
  const otherJobs = new Map<string, number>();
  const candidateIdByCode = new Map<string, string | null>();

  for (const row of sheet.rows) {
    const issues: PlanIssue[] = [];
    const profile = profileForRow(row);
    const rawMobile = cell(row, columns.mobile);
    const mobile = (rawMobile && !UUID_VALUE.test(rawMobile) ? normalizeMobile(rawMobile) : null) ?? normalizeMobile(profile.fields.mobile);
    const fullName = cell(row, columns.fullName) ?? profile.fields.fullName ?? null;
    const rawEmail = cell(row, columns.email) ?? profile.fields.email ?? null;
    const email = normalizeEmail(rawEmail);
    const rowJobId = lower(cell(row, columns.jobId));

    if (!mobile) {
      issues.push({ severity: "ERROR", code: "MISSING_IDENTIFIER", message: "A valid mobile number is required to identify the candidate. Candidate ID and email are ignored for identity matching." });
    }
    if (rawEmail && !email) issues.push({ severity: "WARNING", code: "INVALID_EMAIL", message: `“${rawEmail}” is not a valid email; it will be left blank.` });
    if (rawMobile && !UUID_VALUE.test(rawMobile) && !isPlausibleMobile(mobile)) {
      issues.push({ severity: "WARNING", code: "INVALID_MOBILE", message: `“${rawMobile}” does not look like a 10-digit mobile number.` });
    }
    if (rowJobId && rowJobId !== context.job.jobId) {
      otherJobs.set(rowJobId, (otherJobs.get(rowJobId) ?? 0) + 1);
      issues.push(
        config.acceptOtherJobIds
          ? { severity: "WARNING", code: "OTHER_JOB", message: "This row's Job ID belongs to a different job request; used because you chose to re-use it." }
          : { severity: "ERROR", code: "OTHER_JOB", message: "This row's Job ID belongs to a different job request." },
      );
    }

    // Mobile number is the sole identity key. Candidate IDs and email are deliberately ignored.
    let existing: ExistingCandidate | undefined;
    const byMobile = index.mobile(mobile);
    if (byMobile.length > 1) issues.push({ severity: "ERROR", code: "AMBIGUOUS_MATCH", message: `Mobile number “${mobile}” belongs to multiple existing candidates. Make the mobile number unique before importing.` });
    else existing = byMobile[0];

    const candidateName = fullName ?? existing?.fullName ?? null;
    if (!candidateName) {
      issues.push({ severity: "ERROR", code: "MISSING_NAME", message: "The candidate's name is empty and could not be found in the dashboard." });
    }

    const candidateCode = existing?.candidateCode ?? generatedCandidateCode(null, mobile, candidateName ?? "");
    const codeKey = candidateCode.toLowerCase();
    // The same person applying twice (same mobile, e.g. "08247805403" and
    // "8247805403") is one applicant: the first row is imported, repeats are
    // left out and reported, with nothing to fix in the sheet.
    const firstRow = seenCodes.get(codeKey);
    if (firstRow) {
      issues.push({
        severity: "WARNING",
        code: "DUPLICATE_IN_FILE",
        message: `Same mobile number${mobile ? ` (${mobile})` : ""} as row ${firstRow.rowNumber}${firstRow.name ? ` (${firstRow.name})` : ""}: this applicant applied more than once and is counted once, from row ${firstRow.rowNumber}. This row is not imported again.`,
      });
    }

    // Product: with a product tab chosen, that tab's product for this mobile,
    // and External for anyone not on it. Without one: the applications row,
    // then the first student-detail tab that has a product column.
    let productText: string | null;
    if (config.productsLookup) {
      if (mobile && ambiguousProductKeys.has(mobile)) {
        productText = null;
        issues.push({ severity: "WARNING", code: "AMBIGUOUS_PRODUCT_MATCH", message: `The product tab “${config.productsLookup.sheet}” lists mobile “${mobile}” more than once with different products; the product was left blank.` });
      } else {
        const listed = mobile ? productLookup.get(mobile) ?? null : null;
        if (mobile) (listed ? productTabMatches : productTabExternal).add(mobile);
        productText = listed ?? "External";
      }
    } else {
      productText = cell(row, columns.product) ?? profile.product ?? null;
    }
    const product = productText ? productsByKey.get(productText.toLowerCase()) : undefined;
    if (!product && productText) {
      issues.push({ severity: "WARNING", code: "UNKNOWN_PRODUCT", message: `Product “${productText}” is not in the product list; left blank.` });
    }

    const academic = parseNumber(cell(row, columns.academicScore));
    const fields: CandidateFields = {
      fullName: candidateName ?? "",
      email,
      mobile,
      gender: cell(row, columns.gender) ?? profile.fields.gender ?? null,
      currentCity: cell(row, columns.city) ?? profile.fields.currentCity ?? null,
      state: cell(row, columns.state) ?? profile.fields.state ?? null,
      college: cell(row, columns.college) ?? profile.fields.college ?? null,
      degree: cell(row, columns.degree) ?? profile.fields.degree ?? null,
      department: cell(row, columns.department) ?? profile.fields.department ?? null,
      graduationYear: parseYear(cell(row, columns.graduationYear)) ?? profile.fields.graduationYear ?? null,
      academicScore: academic !== null && academic >= 0 && academic <= 100
        ? academic
        : profile.fields.academicScore != null && profile.fields.academicScore >= 0 && profile.fields.academicScore <= 100
          ? profile.fields.academicScore
          : null,
      resumeUrl: urlCell(row, columns.resumeUrl) ?? profile.fields.resumeUrl ?? null,
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
      if (product && (!existing.category || (existing.category === "EXTERNAL" && product.category !== "EXTERNAL"))) {
        fill.category = product.category;
      }
    }

    const hasError = issues.some((issue) => issue.severity === "ERROR");
    const skipped = hasError || firstRow !== undefined;
    const createApplication = !(existing && context.applicationCandidateIds.has(existing.id));
    const action: Action = !existing ? "CREATE" : createApplication || Object.keys(fill).length > 0 ? (createApplication ? "CREATE" : "UPDATE") : "NO_CHANGE";

    if (!skipped) {
      seenCodes.set(codeKey, { rowNumber: row.rowNumber, name: candidateName });
      if (mobile) (batchByMobile.get(mobile) ?? batchByMobile.set(mobile, new Set()).get(mobile)!).add(candidateCode);
      candidateIdByCode.set(codeKey, existing?.id ?? null);
    }

    const appliedAt = parseDate(cell(row, columns.appliedAt));
    rows.push({
      role: "APPLICATIONS",
      sheet: config.applications.sheet,
      headerRow: config.applications.headerRow,
      rowNumber: row.rowNumber,
      rowRef: mobile,
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
      resumeAssessment: profile.resumeAssessment ?? null,
      additionalProfiles: profile.additionalProfiles,
      },
      action: skipped ? "SKIP" : action,
      issues,
      included: !skipped,
    });
  }

  if (config.productsLookup) {
    batchIssues.push({
      severity: "INFO",
      code: "PRODUCT_TAB",
      message: `Products come from the tab “${config.productsLookup.sheet}”: ${productTabMatches.size} applicant(s) found there; ${productTabExternal.size} not on it are marked External.`,
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
  const existingByMobile = new Map<string, Set<string>>();
  for (const candidate of context.candidates) {
    if (!context.applicationCandidateIds.has(candidate.id)) continue;
    const mobile = normalizeMobile(candidate.mobile);
    if (mobile) (existingByMobile.get(mobile) ?? existingByMobile.set(mobile, new Set()).get(mobile)!).add(candidate.candidateCode);
    candidateIdByCode.set(candidate.candidateCode.toLowerCase(), candidate.id);
  }

  const resolveApplicant = (mapping: StageSheetMapping, row: SheetRow): { code: string | null; issue?: PlanIssue } => {
    const raw = cell(row, mapping.matchColumn);
    if (!raw) return { code: null, issue: { severity: "ERROR", code: "MISSING_MATCH_VALUE", message: "The column used to find the applicant is empty." } };
    const key = UUID_VALUE.test(raw) ? null : normalizeMobile(raw);
    const matches = key
      ? new Set([...(batchByMobile.get(key) ?? []), ...(existingByMobile.get(key) ?? [])])
      : new Set<string>();
    if (!matches || matches.size === 0) {
      return { code: null, issue: { severity: "ERROR", code: "NOT_AN_APPLICANT", message: `“${raw}” does not match an applicant mobile number. Stage sheets must use the candidate's mobile number.` } };
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
      summaryStages[stage] = {
        mode: mapping.mode,
        ...(mapping.mode === "NOT_CONDUCTED" && mapping.reason ? { reason: mapping.reason } : {}),
        ...(mapping.mode === "NOT_CONDUCTED" && mapping.skipReason ? { skipReason: mapping.skipReason } : {}),
        rows: 0,
        selected: 0,
        rejected: 0,
        onHold: 0,
        noShow: 0,
        pending: 0,
        other: 0,
        errors: 0,
        conflicts: 0,
      };
      continue;
    }
    const stats = { mode: "SHEET", rows: 0, selected: 0, rejected: 0, onHold: 0, noShow: 0, pending: 0, other: 0, errors: 0, conflicts: 0 };
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
        // A blank screening decision means the candidate did not attend.
        outcome = key ? mapping.valueMap[key] ?? null : stage === "SCREENING_SHORTLIST" ? "NO_SHOW" : "PENDING";
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
        // SP without a Selection_Basis column: the Remarks say why the candidate was selected.
        selectionBasis: cell(row, mapping.selectionBasisColumn) ?? (stage === "FINAL_SHORTLIST" ? cell(row, mapping.remarksColumn) : null),
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
        const counter = outcome === "SELECTED" ? "selected" : outcome === "REJECTED" ? "rejected" : outcome === "ON_HOLD" ? "onHold" : outcome === "NO_SHOW" ? "noShow" : outcome === "PENDING" ? "pending" : "other";
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

  // Report profile rows that cannot be safely attached to one of this job's applicants.
  // Detail tabs (e.g. Eligible Students) list far more students than applied, so
  // these are summarized once per tab instead of one warning per row.
  for (const lookup of config.profileLookups) {
    if (lookup.sheet === config.applications.sheet || isRecruitmentTab(lookup.sheet)) continue;
    let noMobile = 0;
    let notApplicant = 0;
    for (const row of read(lookup.sheet, lookup.headerRow).rows) {
      const rawKey = cell(row, lookup.columns.mobile);
      if (!rawKey) continue;
      const mobile = UUID_VALUE.test(rawKey) ? null : normalizeMobile(rawKey);
      const profileKey = mobile ? `mobile:${mobile}` : null;
      if (profileKey && ambiguousProfileSheetKeys.has(`${lookup.sheet}:${profileKey}`)) continue;
      if (profileKey && ambiguousProfileKeys.has(profileKey)) continue;
      if (!mobile) {
        noMobile++;
        continue;
      }
      const matches = mobile
        ? new Set([...(batchByMobile.get(mobile) ?? []), ...context.candidates.filter((candidate) => normalizeMobile(candidate.mobile) === mobile && context.applicationCandidateIds.has(candidate.id)).map((candidate) => candidate.candidateCode)])
        : new Set<string>();
      if (matches.size > 1) countAmbiguous(lookup.sheet);
      else if (matches.size === 0) notApplicant++;
    }
    if (noMobile > 0) {
      profileIssues.push({ severity: "WARNING", code: "PROFILE_CANDIDATE_NOT_FOUND", message: `${noMobile} row(s) on ${lookup.sheet} have no valid mobile number and were not used.` });
    }
    if (notApplicant > 0) {
      profileIssues.push({ severity: "INFO", code: "PROFILE_NOT_APPLIED", message: `${notApplicant} row(s) on ${lookup.sheet} belong to students who are not in ${config.applications.sheet}; they are only used to look up details of applicants.` });
    }
  }

  // Everyone in RS/SC/AS/SP must also be in TA; otherwise TA undercounts the drive.
  const stageRowsOutsideTa = rows.filter((row) => row.data.kind === "stage" && row.issues.some((issue) => issue.code === "NOT_AN_APPLICANT"));
  if (stageRowsOutsideTa.length > 0) {
    const byStage = new Map<string, number>();
    for (const row of stageRowsOutsideTa) {
      const code = STAGE_LABELS[(row.data as StageRowData).stage].code;
      byStage.set(code, (byStage.get(code) ?? 0) + 1);
    }
    const detail = [...byStage].map(([code, count]) => `${count} in ${code}`).join(", ");
    batchIssues.push({
      severity: "ERROR",
      code: "STAGE_ROWS_NOT_IN_TA",
      message: `${stageRowsOutsideTa.length} stage row(s) (${detail}) are not in the applications tab “${config.applications.sheet}”, so total applications would be undercounted. Choose the tab that lists every applicant (normally “TA”), or add these candidates to it.`,
    });
  }
  for (const [sheet, count] of ambiguousProfileRows) {
    profileIssues.push({ severity: "WARNING", code: "AMBIGUOUS_PROFILE_MATCH", message: `${count} row(s) on ${sheet} share a mobile number with conflicting name or email details, or match more than one applicant; their details were not used.` });
  }
  batchIssues.push(...profileIssues);

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
        errors: appRows.filter((row) => !row.included && row.issues.some((issue) => issue.severity === "ERROR")).length,
        duplicates: appRows.filter((row) => !row.included && row.issues.some((issue) => issue.code === "DUPLICATE_IN_FILE") && !row.issues.some((issue) => issue.severity === "ERROR")).length,
      },
      stages: summaryStages,
      otherJobIds: [...otherJobs].map(([jobId, count]) => ({ jobId, label: context.jobLabels.get(jobId) ?? null, rows: count })),
      missingFromSource: missing,
      issues,
    },
  };
}
