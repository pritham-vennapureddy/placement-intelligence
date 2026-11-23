import { companyProcessLabel, isMonthKey, POTENTIAL_COMPANY_STATUS_LABELS, type PipelineStatus, type PotentialCompanyStatus } from "@placement/shared";
import { prisma } from "../../db.js";
import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { jobRequestScopeFilter, resolveDataScope } from "../../services/data-scope.service.js";
import { dashboardService } from "../dashboard/dashboard.service.js";
import { insightsService } from "../insights/insights.service.js";
import { companyReasonsService } from "../insights/company-reasons.service.js";
import { companyReasonsQuerySchema, insightsQuerySchema } from "../insights/insights.validators.js";
import { driveNotesService } from "../pulse/drive-notes.service.js";
import { monthlyPipelineService } from "../pulse/monthly-pipeline.service.js";
import type { FunctionDeclaration } from "./gemini.js";

/**
 * Read-only data tools the assistant can call. Each wraps an existing dashboard
 * service, so the user's data scope applies and no contact details are returned.
 */

const MONTH = { type: "string", description: "A month as YYYY-MM, e.g. 2026-11." };

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_month_overview",
    description:
      "Everything for one month: CRM's potential companies list (status, remarks), the job drives on that list (company, role, openings, process status, process dates, unique Academy / assessed-pool / all students at each step and in each company round, latest CRM remark), unique Academy and pool student funnels on those drives, and placements of the month by hired date (any drive). Drives not on the month's potential list are not included. Use for questions about a month, companies in pipeline, openings, how students did at a company or a round.",
    parameters: { type: "object", properties: { month: MONTH }, required: ["month"] },
  },
  {
    name: "list_students",
    description:
      "Unique Academy / assessed-pool students in the drives on one month's potential list with where each one is now (their furthest point across companies) and their stage at every company. Use to answer 'who are they' questions. Returns up to 60 students plus the total.",
    parameters: {
      type: "object",
      properties: {
        month: MONTH,
        group: { type: "string", enum: ["academy", "pool", "all"], description: "Academy, assessed pool, or both. Default academy." },
        outcome: {
          type: "string",
          enum: ["any", "shared", "interviewed", "in_process", "selected", "company_rejected", "internal_rejected"],
          description: "Only students with this outcome at some company. Default any.",
        },
        company: { type: "string", description: "Only students at companies whose name contains this text." },
      },
      required: ["month"],
    },
  },
  {
    name: "get_placement_kpis",
    description:
      "Placement KPIs for a period: KPI 1 placements (by hired month), KPI 2 % positions closed (jobs whose process ended), KPI 3 % hired companies (companies whose process ended), KPI 4 profiles to hired, for each team (< 8 LPA team, Academy, Intensive, External, Academy all LPA), plus a month-by-month big picture (openings received, positions closed, placements by category). Omit from/to for all time.",
    parameters: { type: "object", properties: { from: MONTH, to: MONTH } },
  },
  {
    name: "get_insights",
    description:
      "Funnel insights by job request month: internal process (TA, RS, SC, AS, SP) and company outcomes by category, by company and by month, internal rejection reasons, why screening was skipped, company round results and company rejection reasons by round. Use for 'why' questions about rejections and conversion. Months filter by job request month.",
    parameters: {
      type: "object",
      properties: {
        from: MONTH,
        to: MONTH,
        category: { type: "string", enum: ["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"], description: "Only this student category." },
      },
    },
  },
  {
    name: "get_rejection_reasons",
    description:
      "Why companies rejected our students: company-round rejections grouped by the reason tag the team picked (e.g. Technical / coding, Communication, or the team's own reasons), with counts, students, Academy vs assessed-pool split, by round and by company, plus a sample of students with the note. Months filter by job request month. Use for 'main reasons students get rejected' questions.",
    parameters: {
      type: "object",
      properties: {
        from: MONTH,
        to: MONTH,
        students: { type: "string", enum: ["ACADEMY", "ACADEMY_INTENSIVE", "ALL_ACADEMY"], description: "Which students (default Academy + Intensive)." },
      },
    },
  },
  {
    name: "search_jobs",
    description: "Find job requests by company name, role or job ID. Returns job request id (for get_drive_notes), job ID, company, role, status, process stage, openings, CTC, request and process dates.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Company name, role or the start of a job ID." } }, required: ["query"] },
  },
  {
    name: "get_drive_notes",
    description: "For one job request (use the id from search_jobs): every CRM remark (what the company said, when, channel, next step), the RSA review (what went right / wrong, action items) and how many per-student RSA reports exist.",
    parameters: { type: "object", properties: { jobRequestId: { type: "string" } }, required: ["jobRequestId"] },
  },
];

type Args = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const monthArg = (value: unknown, name = "month") => {
  const month = text(value);
  if (!isMonthKey(month)) throw new Error(`${name} must be a month like 2026-11.`);
  return month;
};
const optionalMonth = (value: unknown, name: string) => (text(value) ? monthArg(value, name) : undefined);
const lastDay = (month: string) => {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0")}`;
};

type MonthData = Awaited<ReturnType<typeof monthlyPipelineService.month>>;
type MonthStudent = MonthData["students"]["people"][number];

/** Where a student stands on one application, best first. */
function positionOf(person: MonthStudent): { rank: number; label: string } {
  const status = person.pipelineStatus as PipelineStatus | null;
  if (person.selected) return { rank: 7, label: "Selected" };
  if (status === "IN_PROCESS" || status === "ON_HOLD") {
    if (person.lastRound) return { rank: 6, label: `${person.lastRound}: ${(person.lastRoundOutcome ?? "").toLowerCase()}` };
    return { rank: 5, label: status === "ON_HOLD" ? "On hold with company" : "Shared, waiting for company" };
  }
  if (person.shared && status !== "REJECTED" && status !== "DROPPED") return { rank: 5, label: "Shared with company" };
  if (person.internal === "SP") return { rank: 4, label: "Shortlisted by us (SP), not shared yet" };
  if (person.internal === "IN_PROGRESS") return { rank: 3, label: "In our process (TA/RS/SC/AS)" };
  if (status === "REJECTED") return { rank: 2, label: person.lastRound ? `Rejected by company at ${person.lastRound}` : "Rejected by company" };
  if (status === "DROPPED") return { rank: 2, label: "Dropped" };
  const internal: Record<string, string> = { AS_REJECTED: "Rejected at AS", SC_REJECTED: "Rejected at SC", SC_NO_SHOW: "SC no-show", RS_REJECTED: "Rejected at RS" };
  return { rank: 1, label: internal[person.internal] ?? person.internal };
}

const OUTCOME_TEST: Record<string, (person: MonthStudent) => boolean> = {
  any: () => true,
  shared: (person) => person.shared,
  interviewed: (person) => person.interviewed,
  in_process: (person) => person.pipelineStatus === "IN_PROCESS" || person.pipelineStatus === "ON_HOLD",
  selected: (person) => person.selected,
  company_rejected: (person) => person.pipelineStatus === "REJECTED",
  internal_rejected: (person) => person.internal.endsWith("REJECTED") || person.internal === "SC_NO_SHOW",
};

/** A month's student funnel with names that say exactly what each number is. */
function funnel(group: MonthData["students"]["academy"]) {
  return {
    uniqueStudentsInPipeline_applied: group.students,
    applications_notUnique: group.applications,
    uniqueShortlistedByUs_SP: group.finalShortlisted,
    uniqueSharedWithCompany: group.shared,
    uniqueGotInterview: group.interviewed,
    uniqueStillInCompanyProcess: group.inProcess,
    uniqueSelected: group.selected,
    uniqueRejectedInternally_RS_SC_AS: group.internalRejected,
    uniqueRejectedByCompany: group.companyRejected,
    byCompanyRound_genericLabels: group.stages,
  };
}

/** Runs tools for one chat turn; month data is fetched once per month. */
export function createToolRunner(user: AuthenticatedUser) {
  const months = new Map<string, Promise<MonthData>>();
  const monthData = (month: string) => {
    if (!months.has(month)) months.set(month, monthlyPipelineService.month(user, month));
    return months.get(month)!;
  };

  const tools: Record<string, (args: Args) => Promise<unknown>> = {
    async get_month_overview(args) {
      const month = monthArg(args.month);
      const data = await monthData(month);
      return {
        month,
        potentialList: {
          summary: data.potential.summary,
          entries: data.potential.entries.map((entry) => ({
            company: entry.company.name,
            jobId: entry.jobRequest.jobId,
            role: entry.jobRequest.roleTitle,
            status: POTENTIAL_COMPANY_STATUS_LABELS[entry.status as PotentialCompanyStatus],
            expectedOpenings: entry.expectedOpenings ?? entry.jobRequest.openings,
            expectedStart: entry.expectedStartDate,
            crmOwner: entry.crmOwner?.fullName ?? null,
            remarks: entry.remarks,
            carriedFromEarlierMonth: Boolean(entry.carriedFrom),
            latestUpdate: entry.history[0] ? { on: entry.history[0].changedAt, note: entry.history[0].note } : null,
          })),
        },
        drives: {
          summary: data.drives.summary,
          items: data.drives.items.map((drive) => ({
            jobRequestId: drive.jobRequestId,
            company: drive.companyName,
            role: drive.roleTitle,
            psm: drive.psmName,
            openings: drive.openings,
            processStatus: companyProcessLabel(drive.phase as never, drive.roundName),
            processStart: drive.processStartDate,
            processEnd: drive.processEndDate,
            startsThisMonth: drive.startsInMonth,
            // Per group (academy / pool / all): unique students who applied, were shortlisted (SP), shared, interviewed, are in process, rejected, selected.
            uniqueStudentsByStep: drive.stages?.steps ?? null,
            companyRounds: drive.stages?.rounds.map(({ name, academy, pool, all }) => ({ round: name, academy, pool, all })) ?? [],
            latestCrmRemark: drive.lastCrmRemark,
            crmRemarks: drive.crmRemarkCount,
            rsaReviewWritten: drive.hasRsaReview,
          })),
        },
        uniqueStudentFunnels: { academy: funnel(data.students.academy), assessedPool: funnel(data.students.pool) },
        placementsByHiredDate: {
          ...data.placements,
          people: data.placements.people.map((person) => ({
            name: person.fullName, category: person.category, inPool: person.inPool, company: person.companyName, role: person.roleTitle,
            ctcLpa: person.ctcLpa, hiredOn: person.hiredOn, dateFrom: person.hiredOnSource,
          })),
        },
      };
    },

    async list_students(args) {
      const month = monthArg(args.month);
      const group = ["academy", "pool", "all"].includes(text(args.group)) ? text(args.group) : "academy";
      const outcome = OUTCOME_TEST[text(args.outcome)] ? text(args.outcome) : "any";
      const company = text(args.company).toLowerCase();
      const data = await monthData(month);
      const rows = data.students.people.filter((person) =>
        (group === "all" || (group === "academy" ? person.academy : person.inPool))
        && (!company || person.companyName.toLowerCase().includes(company)));
      const byCandidate = new Map<string, MonthStudent[]>();
      for (const person of rows) byCandidate.set(person.candidateId, [...(byCandidate.get(person.candidateId) ?? []), person]);
      const students = [...byCandidate.values()]
        .filter((applications) => applications.some(OUTCOME_TEST[outcome]!))
        .map((applications) => {
          const sorted = [...applications].sort((x, y) => positionOf(y).rank - positionOf(x).rank);
          const best = sorted[0]!;
          return {
            name: best.fullName,
            code: best.candidateCode,
            segment: [best.academy ? "Academy" : null, best.inPool ? `Pool${best.tier ? ` ${best.tier}` : ""}` : null].filter(Boolean).join(" + "),
            whereNow: `${positionOf(best).label} (${best.companyName})`,
            rank: positionOf(best).rank,
            companies: sorted.map((person) => `${person.companyName}: ${positionOf(person).label}`),
          };
        })
        .sort((x, y) => y.rank - x.rank || x.name.localeCompare(y.name));
      return { month, group, outcome, company: company || null, totalUniqueStudents: students.length, shown: Math.min(students.length, 60), students: students.slice(0, 60).map(({ rank: _rank, ...rest }) => rest) };
    },

    async get_placement_kpis(args) {
      const from = optionalMonth(args.from, "from");
      const to = optionalMonth(args.to, "to");
      const data = await dashboardService.getPlacementKpis(user, { ...(from ? { from: `${from}-01` } : {}), ...(to ? { to: lastDay(to) } : {}) });
      return {
        period: { from: from ?? "all time", to: to ?? "all time" },
        ctcThresholdLpa: data.ctcThresholdLpa,
        teams: data.segments.map((segment) => ({ team: segment.label, ...data.totals[segment.key] })),
        bigPicture: { totals: data.overview.totals, monthly: data.overview.monthly.slice(0, 18) },
        hiredDates: { placements: data.hiredDates.placements, withHiredDate: data.hiredDates.STUDENT, fromLastRound: data.hiredDates.ROUND, fromJobEnd: data.hiredDates.JOB, missing: data.hiredDates.missing },
        jobsWithoutCtc: data.coverage.jobsWithoutCtc,
      };
    },

    async get_insights(args) {
      const query = insightsQuerySchema.parse({
        ...(optionalMonth(args.from, "from") ? { from: text(args.from) } : {}),
        ...(optionalMonth(args.to, "to") ? { to: text(args.to) } : {}),
        ...(["ACADEMY", "ACADEMY_INTENSIVE", "EXTERNAL"].includes(text(args.category)) ? { category: text(args.category) } : {}),
      });
      const data = await insightsService.overview(user, query);
      const { screeningSkipped, ...rest } = data as typeof data & { screeningSkipped: { total: number; byReason: unknown[]; jobs: unknown[] } };
      return trim({ ...rest, screeningSkipped: { total: screeningSkipped.total, byReason: screeningSkipped.byReason, jobs: screeningSkipped.jobs.slice(0, 20) } });
    },

    async get_rejection_reasons(args) {
      const query = companyReasonsQuerySchema.parse({
        ...(optionalMonth(args.from, "from") ? { from: text(args.from) } : {}),
        ...(optionalMonth(args.to, "to") ? { to: text(args.to) } : {}),
        academyCategory: ["ACADEMY", "ACADEMY_INTENSIVE", "ALL_ACADEMY"].includes(text(args.students)) ? text(args.students) : "ALL_ACADEMY",
      });
      const data = await companyReasonsService.overview(user, query);
      return trim({
        totals: data.totals,
        byReason: data.byTag.map(({ tagId: _id, ...row }) => row),
        byRound: data.byRound.map(({ tagId: _id, ...row }) => row),
        byCompany: data.byCompany.map(({ tagId: _id, jobRequestId: _job, ...row }) => row),
        sampleStudents: data.students.slice(0, 40).map((row) => ({ name: row.fullName, product: row.product, inPool: row.inPool, company: row.companyName, round: row.roundName, reason: row.reason, note: row.note })),
      }) as Record<string, unknown>;
    },

    async search_jobs(args) {
      const query = text(args.query);
      if (!query) throw new Error("Give a company name, role or job ID.");
      const scope = await resolveDataScope(user);
      const jobs = await prisma.jobRequest.findMany({
        where: {
          ...jobRequestScopeFilter(scope),
          archivedAt: null,
          OR: [{ roleTitle: { contains: query, mode: "insensitive" } }, { company: { name: { contains: query, mode: "insensitive" } } }, { jobId: { startsWith: query.toLowerCase() } }],
        },
        select: {
          id: true, jobId: true, roleTitle: true, status: true, processPhase: true, openings: true, ctcLpa: true, requestDate: true,
          companyProcessStartDate: true, companyProcessEndDate: true, company: { select: { name: true } }, psmOwner: { select: { fullName: true } },
          processRound: { select: { name: true } },
        },
        orderBy: { requestDate: "desc" },
        take: 15,
      });
      const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
      return jobs.map((job) => ({
        jobRequestId: job.id, jobId: job.jobId, company: job.company.name, role: job.roleTitle, status: job.status,
        processStatus: companyProcessLabel(job.processPhase, job.processRound?.name), openings: job.openings, ctcLpa: job.ctcLpa,
        psm: job.psmOwner?.fullName ?? null, requested: day(job.requestDate), processStart: day(job.companyProcessStartDate), processEnd: day(job.companyProcessEndDate),
      }));
    },

    async get_drive_notes(args) {
      const id = text(args.jobRequestId);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Use the jobRequestId from search_jobs.");
      const notes = await driveNotesService.get(user, id);
      return {
        crmRemarks: notes.crmRemarks.map((remark) => ({ on: remark.interactionOn, channel: remark.channel, remark: remark.remark, nextStep: remark.nextStep, by: remark.createdBy.fullName })),
        rsaReview: notes.rsaReview ? { wentRight: notes.rsaReview.wentRight, wentWrong: notes.rsaReview.wentWrong, actionItems: notes.rsaReview.actionItems } : null,
        studentRsaReports: notes.studentReports,
      };
    },
  };

  return async (name: string, args: Args): Promise<Record<string, unknown>> => {
    const tool = tools[name];
    if (!tool) return { error: `Unknown tool ${name}.` };
    try {
      return { result: await tool(args ?? {}) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "The data could not be loaded." };
    }
  };
}

/** Keeps a tool result small enough for the model: long lists are cut to their first 40 items. */
function trim(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).map((item) => trim(item, depth + 1));
    return value.length > 40 ? [...items, `…and ${value.length - 40} more`] : items;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trim(item, depth + 1)]));
  }
  return value;
}

