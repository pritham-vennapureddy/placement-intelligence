import { companyProcessLabel, POTENTIAL_COMPANY_STATUS_LABELS, universalProductLabel, type CompanyProcessPhase, type PotentialCompanyStatus } from "@placement/shared";
import { format } from "date-fns";
import type { MonthlyDrive, MonthlyPipeline, MonthlyStudent, PipelineEntry, ReasonCount } from "../../types/pulse";

/**
 * The Monthly page's working model: one row per job drive on CRM's potential
 * list, and totals worked out from whatever rows are left after filtering, so
 * the big picture always matches the grid underneath it.
 */

export type ProcessState = "YET_TO_START" | "STARTED" | "ENDED";
export const PROCESS_STATE_LABELS: Record<ProcessState, string> = { YET_TO_START: "Yet to start", STARTED: "In process", ENDED: "Process ended" };

/** Ended when marked done or given an end date; started once CVs reach the company or a start date is set. Same rule as the API. */
export function processState(job: { phase: string; processStartDate: string | null; processEndDate: string | null }): ProcessState {
  if (job.phase === "PROCESS_DONE_HIRED" || job.phase === "PROCESS_DONE_NOT_HIRED" || job.processEndDate) return "ENDED";
  if (job.phase !== "YET_TO_SHARE_CVS" || job.processStartDate) return "STARTED";
  return "YET_TO_START";
}

/** A company is in process if any drive runs, yet to start if any waits, ended when all ended. */
function companyState(states: ProcessState[]): ProcessState {
  if (states.includes("STARTED")) return "STARTED";
  if (states.includes("YET_TO_START")) return "YET_TO_START";
  return "ENDED";
}

export const INACTIVE_STATUSES: PotentialCompanyStatus[] = ["DROPPED", "NO_RESPONSE"];

/** Our shortlisting stages, in order. */
export const INTERNAL = ["resume", "screening", "assignment", "final"] as const;
export type Internal = (typeof INTERNAL)[number];
export const INTERNAL_LABELS: Record<Internal, string> = { resume: "Resume shortlist", screening: "Screening", assignment: "Assignment", final: "Final shortlist" };

/**
 * Signs that a drive really ran a stage. Passing a later stage implies the
 * earlier flags, so those alone do not count; a rejection or a stop at the
 * stage does. A drive with none of them had no shortlisting by us: no resume
 * shortlist and no final shortlist (SP) sheet, so only the company sheet decides.
 */
const RAN: Record<Internal, (person: MonthlyStudent) => boolean> = {
  resume: (person) => person.rejectedAt.resume || (person.passed.resume && !person.passed.screening),
  screening: (person) => person.rejectedAt.screening || person.rejectedAt.screeningNoShow || (person.passed.screening && !person.passed.assignment),
  assignment: (person) => person.rejectedAt.assignment || (person.passed.assignment && !person.passed.finalShortlist),
  final: (person) => person.passed.finalShortlist,
};

export const stagesRunBy = (people: MonthlyStudent[]): Internal[] => {
  const applied = people.filter((person) => !person.fromCompanySheet);
  return INTERNAL.filter((stage) => applied.some(RAN[stage]));
};

const TERMINAL = new Set(["SELECTED", "OFFER_RELEASED", "OFFER_ACCEPTED", "JOINED", "REJECTED", "DROPPED"]);

/** The company is done with this student on this drive. */
export function applicationEnded(person: MonthlyStudent, driveOver: boolean) {
  return driveOver || person.processEnded || TERMINAL.has(person.pipelineStatus ?? "");
}

/** Per drive: Academy or pool students and where they are on it. */
export interface DriveStudentCounts { total: number; notShared: number; inProcess: number; completed: number; selected: number }

function driveCounts(people: MonthlyStudent[], driveOver: boolean): DriveStudentCounts {
  const counts = { total: 0, notShared: 0, inProcess: 0, completed: 0, selected: 0 };
  const seen = new Set<string>();
  for (const person of people) {
    if (seen.has(person.candidateId)) continue;
    seen.add(person.candidateId);
    counts.total++;
    if (person.selected) counts.selected++;
    if (!person.shared) counts.notShared++;
    else if (applicationEnded(person, driveOver)) counts.completed++;
    else counts.inProcess++;
  }
  return counts;
}

export interface BoardRow {
  id: string;
  entry: PipelineEntry;
  drive: MonthlyDrive | undefined;
  jobRequestId: string;
  jobCode: string;
  company: string;
  companyId: string;
  role: string;
  crmStatus: PotentialCompanyStatus;
  phase: CompanyProcessPhase;
  phaseLabel: string;
  /** Universal product names (Academy / Intensive / External) eligible to apply. */
  products: string[];
  techStack: string[];
  ctcLpa: number | null;
  requestDate: string | null;
  /** Actual company process dates (from the students' dates). */
  processStart: string | null;
  processEnd: string | null;
  companySheetUrl: string | null;
  internalSheetUrl: string | null;
  review: { wentRight: string | null; wentWrong: string | null; actionItems: string | null };
  state: ProcessState;
  crmOwner: string;
  psm: string;
  expectedStart: string | null;
  openings: number;
  listedSince: string;
  /** "New this month" or "Carried in". */
  origin: string;
  academy: DriveStudentCounts;
  pool: DriveStudentCounts;
  /** Everyone on the drive: Academy, pool, External, and students added from the company sheet. */
  all: DriveStudentCounts;
  /** Our shortlisting stages this drive ran; empty = no shortlisting by us. */
  stagesRun: Internal[];
  /** Students added from the company sheet without applying. */
  fromCompanySheet: number;
  people: MonthlyStudent[];
  lastUpdate: { on: string | null; text: string } | null;
}

const monthLabel = (month: string) => format(new Date(`${month}-01T00:00:00`), "MMM yyyy");

export function buildRows(data: MonthlyPipeline): BoardRow[] {
  const drives = new Map(data.drives.items.map((drive) => [drive.jobRequestId, drive]));
  const peopleByJob = new Map<string, MonthlyStudent[]>();
  for (const person of data.students.people) peopleByJob.set(person.jobRequestId, [...(peopleByJob.get(person.jobRequestId) ?? []), person]);

  return data.potential.entries.map((entry) => {
    const job = entry.jobRequest;
    const drive = drives.get(job.id);
    const phase = drive?.phase ?? job.processPhase;
    const state = processState({ phase, processStartDate: drive?.processStartDate ?? job.companyProcessStartDate, processEndDate: drive?.processEndDate ?? job.companyProcessEndDate ?? null });
    const people = peopleByJob.get(job.id) ?? [];
    const over = state === "ENDED";
    const lastNote = entry.history.find((item) => item.note);
    const lastUpdate = drive?.lastCrmRemark
      ? { on: drive.lastCrmRemark.on, text: drive.lastCrmRemark.remark }
      : lastNote ? { on: lastNote.changedAt.slice(0, 10), text: lastNote.note! } : entry.remarks ? { on: null, text: entry.remarks } : null;
    return {
      id: entry.id,
      entry,
      drive,
      jobRequestId: job.id,
      jobCode: job.jobId,
      company: entry.company.name,
      companyId: entry.company.id,
      role: job.roleTitle,
      crmStatus: entry.status,
      phase,
      products: [...new Set((drive?.products ?? "").split(", ").filter(Boolean).map((name) => universalProductLabel(name) ?? name))],
      techStack: (drive?.techStack ?? "").split(", ").filter(Boolean),
      ctcLpa: drive?.ctcLpa ?? null,
      requestDate: drive?.requestDate ?? null,
      processStart: drive?.processStartDate ?? job.companyProcessStartDate,
      processEnd: drive?.processEndDate ?? job.companyProcessEndDate,
      companySheetUrl: drive?.companySheetUrl ?? null,
      internalSheetUrl: drive?.internalSheetUrl ?? null,
      review: drive?.review ?? { wentRight: null, wentWrong: null, actionItems: null },
      phaseLabel: companyProcessLabel(phase, drive?.roundName ?? job.processRound?.name),
      state,
      crmOwner: entry.crmOwner?.fullName ?? "Not set",
      psm: drive?.psmName ?? job.psmOwner?.fullName ?? "Not set",
      expectedStart: entry.expectedStartDate ?? drive?.processStartDate ?? job.companyProcessStartDate,
      openings: entry.expectedOpenings ?? job.openings,
      listedSince: monthLabel(entry.firstListedMonth),
      origin: entry.carriedFrom ? "Carried in" : "New this month",
      academy: driveCounts(people.filter((person) => person.academy), over),
      pool: driveCounts(people.filter((person) => person.inPool), over),
      all: driveCounts(people, over),
      stagesRun: stagesRunBy(people),
      fromCompanySheet: people.filter((person) => person.fromCompanySheet).length,
      people,
      lastUpdate,
    };
  });
}

/** Columns the grid can filter by value, Excel style. A row with several values (products, skills) matches if any is ticked. */
export const FILTER_COLUMNS: Record<string, { label: string; value: (row: BoardRow) => string | string[] }> = {
  company: { label: "Company", value: (row: BoardRow) => row.company },
  role: { label: "Role", value: (row: BoardRow) => row.role },
  products: { label: "Product", value: (row: BoardRow) => (row.products.length ? row.products : ["Not set"]) },
  techStack: { label: "Tech stack", value: (row: BoardRow) => (row.techStack.length ? row.techStack : ["Not set"]) },
  crmStatus: { label: "CRM status", value: (row: BoardRow) => POTENTIAL_COMPANY_STATUS_LABELS[row.crmStatus] },
  state: { label: "Process stage", value: (row: BoardRow) => PROCESS_STATE_LABELS[row.state] },
  phase: { label: "Company status", value: (row: BoardRow) => row.phaseLabel },
  crmOwner: { label: "CRM owner", value: (row: BoardRow) => row.crmOwner },
  psm: { label: "Placement owner", value: (row: BoardRow) => row.psm },
  origin: { label: "On list", value: (row: BoardRow) => row.origin },
  listedSince: { label: "On list since", value: (row: BoardRow) => row.listedSince },
  requestMonth: { label: "Job requested month", value: (row: BoardRow) => (row.requestDate ? monthLabel(row.requestDate.slice(0, 7)) : "Not set") },
  shortlisting: { label: "Our shortlisting", value: (row: BoardRow) => (row.stagesRun.length ? "Done" : "Not done") },
  review: { label: "Went right / wrong", value: (row: BoardRow) => (row.review.wentRight || row.review.wentWrong ? "Written" : "Not written") },
};
export type FilterKey = string;
export type ColumnFilters = Partial<Record<FilterKey, string[]>>;

/** A row's values for one filter column, always as a list. */
export const filterValues = (key: FilterKey, row: BoardRow): string[] => {
  const value = FILTER_COLUMNS[key]!.value(row);
  return Array.isArray(value) ? value : [value];
};

export function matchesSearch(row: BoardRow, q: string) {
  if (!q) return true;
  const text = `${row.jobCode} ${row.company} ${row.role} ${row.crmOwner} ${row.psm} ${row.techStack.join(" ")}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

export function applyFilters(rows: BoardRow[], filters: ColumnFilters, except?: FilterKey) {
  return rows.filter((row) => (Object.keys(filters) as FilterKey[]).every((key) => {
    if (key === except) return true;
    const allowed = filters[key];
    return !allowed || allowed.length === 0 || !FILTER_COLUMNS[key] || filterValues(key, row).some((value) => allowed.includes(value));
  }));
}

export type StudentPosition = "SELECTED" | "IN_PROCESS" | "ENDED_NOT_SELECTED" | "IN_SHORTLISTING" | "REJECTED_INTERNALLY" | "NOT_SHARED_DRIVE_OVER";
export type PositionCounts = Record<StudentPosition, number> & { students: number };

/**
 * Where each unique student stands across the given drives, counted once at
 * their furthest point. Same order as the API's big picture.
 */
function positions(rows: BoardRow[], keep: (person: MonthlyStudent) => boolean): PositionCounts {
  const result: PositionCounts = { students: 0, SELECTED: 0, IN_PROCESS: 0, ENDED_NOT_SELECTED: 0, IN_SHORTLISTING: 0, REJECTED_INTERNALLY: 0, NOT_SHARED_DRIVE_OVER: 0 };
  for (const position of uniquePositions(rows, keep).values()) {
    result[position]++;
    result.students++;
  }
  return result;
}

/** Each unique student's furthest point across the given drives. */
export function uniquePositions(rows: BoardRow[], keep: (person: MonthlyStudent) => boolean = () => true): Map<string, StudentPosition> {
  const per = new Map<string, { selected: boolean; inProcess: boolean; shared: boolean; allRejected: boolean; openShortlisting: boolean }>();
  for (const row of rows) {
    const over = row.state === "ENDED";
    for (const person of row.people) {
      if (!keep(person)) continue;
      const ended = applicationEnded(person, over);
      const known = per.get(person.candidateId) ?? { selected: false, inProcess: false, shared: false, allRejected: true, openShortlisting: false };
      known.selected ||= person.selected;
      known.inProcess ||= person.shared && !ended;
      known.shared ||= person.shared;
      known.allRejected &&= person.internalRejected;
      known.openShortlisting ||= !person.shared && !person.internalRejected && !over;
      per.set(person.candidateId, known);
    }
  }
  return new Map([...per].map(([candidateId, student]) => [candidateId, (
    student.selected ? "SELECTED" : student.inProcess ? "IN_PROCESS" : student.shared ? "ENDED_NOT_SELECTED"
      : student.openShortlisting ? "IN_SHORTLISTING" : student.allRejected ? "REJECTED_INTERNALLY" : "NOT_SHARED_DRIVE_OVER"
  ) as StudentPosition]));
}

export type Split = Record<ProcessState, number> & { total: number };
const split = (): Split => ({ total: 0, YET_TO_START: 0, STARTED: 0, ENDED: 0 });

export interface BoardSummary {
  companies: Split;
  drives: Split;
  openings: Split;
  byCrmStatus: Partial<Record<PotentialCompanyStatus, number>>;
  academy: PositionCounts;
  pool: PositionCounts;
  all: PositionCounts;
  reasons: ReasonCount[];
}

export function summarize(rows: BoardRow[]): BoardSummary {
  const companies = split();
  const drives = split();
  const openings = split();
  const byCrmStatus: BoardSummary["byCrmStatus"] = {};
  const states = new Map<string, ProcessState[]>();
  for (const row of rows) {
    drives.total++;
    drives[row.state]++;
    openings.total += row.openings;
    openings[row.state] += row.openings;
    byCrmStatus[row.crmStatus] = (byCrmStatus[row.crmStatus] ?? 0) + 1;
    states.set(row.companyId, [...(states.get(row.companyId) ?? []), row.state]);
  }
  for (const list of states.values()) {
    companies.total++;
    companies[companyState(list)]++;
  }
  const reasons = new Map<string, ReasonCount>();
  for (const row of rows) {
    for (const reason of row.drive?.notSelectedReasons ?? []) {
      const key = reason.tagId ?? "";
      const known = reasons.get(key);
      if (known) { known.academy += reason.academy; known.pool += reason.pool; known.total += reason.total; }
      else reasons.set(key, { ...reason });
    }
  }
  return {
    companies, drives, openings, byCrmStatus,
    academy: positions(rows, (person) => person.academy),
    pool: positions(rows, (person) => person.inPool),
    all: positions(rows, () => true),
    reasons: [...reasons.values()].sort((x, y) => Number(x.tagId === null) - Number(y.tagId === null) || y.total - x.total),
  };
}
