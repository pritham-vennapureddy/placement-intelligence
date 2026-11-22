import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { companyProcessLabel } from "@placement/shared";
import { format, subMonths } from "date-fns";
import { Award, ClipboardCheck, Download, GraduationCap, Info, SearchX, UserRoundCheck, Users, UserX } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { KpiCard } from "../../components/kpi-card";
import { PageHeader } from "../../components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "../../components/states";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { usePermissions } from "../../hooks/use-permissions";
import { academyInsightsApi } from "../../services/tracking-api";
import type { AcademyCategory, AcademyComparison, AcademyFilters, AcademyInsights, AcademyMetrics, AcademySegment } from "../../types/academy";
import type { InsightDateBasis } from "../../types/tracking";
import { downloadCsv, type CsvValue } from "../../utils/csv";
import { StudentsPanel } from "./academy-students";
import { CompanyReasonsPanel } from "./company-reasons-panel";

const BAR = "#2a78d6";

const CATEGORY_OPTIONS: Record<AcademyCategory, string> = { ACADEMY: "Academy", ACADEMY_INTENSIVE: "Academy Intensive", ALL_ACADEMY: "Academy + Intensive" };
const SEGMENT_OPTIONS: Record<AcademySegment, string> = {
  ALL: "All students",
  ASSESSED_POOL: "Assessed pool",
  NOT_IN_POOL: "Not in assessed pool",
  BUCKET_A: "Tier 1 (bucket A)",
  BUCKET_B: "Bucket B",
  BUCKET_C: "Bucket C",
};
const COMPARISON_LABELS: Record<AcademyComparison, string> = {
  OVERALL: "Overall (all categories)",
  ACADEMY: "Academy",
  ASSESSED_POOL: "Assessed pool",
  NOT_IN_POOL: "Academy, not in pool",
  BUCKET_A: "Tier 1 (bucket A)",
  BUCKET_B: "Bucket B",
  BUCKET_C: "Bucket C",
};
const FUNNEL_COLUMNS: AcademyComparison[] = ["ACADEMY", "ASSESSED_POOL", "NOT_IN_POOL", "BUCKET_A"];

/** `rejected` / `noShow`: shown under the step, so each internal stage reads "passed · rejected". */
const FUNNEL_STEPS: { key: string; label: string; hint: string; value: (row: AcademyMetrics) => number; rejected?: (row: AcademyMetrics) => number; noShow?: (row: AcademyMetrics) => number }[] = [
  { key: "ta", label: "Applied", hint: "Applications in the period", value: (row) => row.applications },
  { key: "rs", label: "Passed resume shortlist", hint: "Our team shortlisted the resume", value: (row) => row.resumeShortlisted, rejected: (row) => row.rejectedAt.RS },
  { key: "sc", label: "Passed screening", hint: "Cleared our screening call / test", value: (row) => row.screeningCleared, rejected: (row) => row.rejectedAt.SC, noShow: (row) => row.screeningNoShow },
  { key: "as", label: "Passed assignment", hint: "Cleared our assignment", value: (row) => row.assignmentCleared, rejected: (row) => row.rejectedAt.AS },
  { key: "sp", label: "Final shortlist", hint: "Picked to send to the company", value: (row) => row.finalShortlisted },
  { key: "shared", label: "Shared with company", hint: "Profile sent to the company", value: (row) => row.shared },
  { key: "iv", label: "Interviewed", hint: "Attended at least one company round", value: (row) => row.interviewed },
  { key: "sel", label: "Selected", hint: "Selected, offered or joined", value: (row) => row.selected },
  { key: "off", label: "Offer released", hint: "", value: (row) => row.offered },
  { key: "join", label: "Joined", hint: "", value: (row) => row.joined },
];

const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const pct = (part: number, whole: number) => {
  const value = ratio(part, whole);
  return value === null ? "—" : `${value}%`;
};
const monthLabel = (month: string | null) => (month ? format(new Date(`${month}-01T00:00:00`), "MMM yyyy") : "—");
const csvName = (part: string, filters: AcademyFilters) => ["academy", part, filters.from, filters.to].filter(Boolean).join("-");
const num = (value: number, tone?: string) => <span className={value === 0 ? "text-slate-300" : tone}>{value}</span>;

function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function CsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return <Button size="sm" variant="outline" disabled={disabled} onClick={onClick}><Download size={13} /> Download CSV</Button>;
}

/** A single-series bar next to its number; the number carries the value, the bar only the shape. */
function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full min-w-24 rounded-full bg-slate-100" aria-hidden>
      <div className="h-2 rounded-full" style={{ width: `${width}%`, background: BAR }} />
    </div>
  );
}

// ───────────────────────────── Conversion tables ─────────────────────────────

type ConversionRow = AcademyMetrics & { lead: ReactNode; key: string };

const CONVERSION_HEADER = ["Applied", "Final shortlist", "Final shortlist % of applied", "Shared", "Interviewed", "Selected", "Selected % of applied", "Selected % of interviewed", "Rejected internally", "Rejected internally %"];
const conversionCsv = (row: AcademyMetrics): CsvValue[] => [
  row.applications, row.finalShortlisted, pct(row.finalShortlisted, row.applications), row.shared, row.interviewed, row.selected,
  pct(row.selected, row.applications), pct(row.selected, row.interviewed), row.internalRejected, pct(row.internalRejected, row.applications),
];

function ConversionTable({ rows, leadHeader }: { rows: ConversionRow[]; leadHeader: string[] }) {
  if (rows.length === 0) return <EmptyState title="No applications for these filters" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
          <tr>
            {leadHeader.map((label) => <th key={label} className="whitespace-nowrap px-4 py-2">{label}</th>)}
            <th className="px-3 py-2 text-right">Applied</th>
            <th className="px-3 py-2 text-right" title="Rejected at resume shortlist, screening or assignment">Rejected internally</th>
            <th className="px-3 py-2 text-right">Final shortlist</th>
            <th className="px-3 py-2 text-right">Shared</th>
            <th className="px-3 py-2 text-right">Interviewed</th>
            <th className="px-3 py-2 text-right">Selected</th>
            <th className="px-3 py-2 text-right" title="Selected ÷ applications">Selected % of applied</th>
            <th className="px-3 py-2 text-right" title="Selected ÷ interviewed">Selected % of interviewed</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-slate-100 align-top">
              {row.lead}
              <td className="px-3 py-2 text-right">{num(row.applications)}</td>
              <td className="px-3 py-2 text-right">{num(row.internalRejected, "text-rose-600")} <span className="text-[11px] text-slate-400">{pct(row.internalRejected, row.applications)}</span></td>
              <td className="px-3 py-2 text-right">{num(row.finalShortlisted)} <span className="text-[11px] text-slate-400">{pct(row.finalShortlisted, row.applications)}</span></td>
              <td className="px-3 py-2 text-right">{num(row.shared)}</td>
              <td className="px-3 py-2 text-right">{num(row.interviewed)}</td>
              <td className="px-3 py-2 text-right">{num(row.selected, "font-semibold text-emerald-700")}</td>
              <td className="px-3 py-2 text-right font-medium">{pct(row.selected, row.applications)}</td>
              <td className="px-3 py-2 text-right">{pct(row.selected, row.interviewed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────────── Tabs ─────────────────────────────────

function FunnelTab({ data, filters }: { data: AcademyInsights; filters: AcademyFilters }) {
  const bySegment = Object.fromEntries(data.segments.map((row) => [row.segment, row])) as unknown as Record<AcademyComparison, AcademyMetrics>;
  const academy = bySegment.ACADEMY;
  const download = () => downloadCsv(csvName("funnel", filters),
    ["Step", ...FUNNEL_COLUMNS.flatMap((segment) => [COMPARISON_LABELS[segment], `${COMPARISON_LABELS[segment]} step %`, `${COMPARISON_LABELS[segment]} % of applied`])],
    [
      ...FUNNEL_STEPS.map((step, index) => [step.label, ...FUNNEL_COLUMNS.flatMap((segment) => {
        const row = bySegment[segment];
        const previous = index === 0 ? step.value(row) : FUNNEL_STEPS[index - 1]!.value(row);
        return [step.value(row), index === 0 ? "" : pct(step.value(row), previous), pct(step.value(row), row.applications)];
      })]),
      ...FUNNEL_STEPS.flatMap((step) => [
        ...(step.rejected ? [[`${step.label}: rejected`, ...FUNNEL_COLUMNS.flatMap((segment) => {
          const row = bySegment[segment];
          return [step.rejected!(row), "", pct(step.rejected!(row), row.applications)];
        })]] : []),
        ...(step.noShow ? [[`${step.label}: no-show`, ...FUNNEL_COLUMNS.flatMap((segment) => {
          const row = bySegment[segment];
          return [step.noShow!(row), "", pct(step.noShow!(row), row.applications)];
        })]] : []),
      ]),
      ...data.companyRounds.map((round) => [`Company round: ${round.label} (appeared / cleared / rejected)`, ...FUNNEL_COLUMNS.flatMap((segment) => {
        const r = round.bySegment[segment];
        return [`${r.appeared} / ${r.cleared} / ${r.rejected}`, pct(r.cleared, r.appeared), ""];
      })]),
    ]);
  return (
    <div className="space-y-4">
      <Section
        title="Step by step: how many got through"
        description="Each step counts applications (one student in 3 drives counts 3 times). The grey % is how many of the step above made it. If a drive skipped a step, everyone who reached a later step counts as passing it."
        action={<CsvButton onClick={download} />}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Step</th>
                <th className="w-48 px-3 py-2">{COMPARISON_LABELS.ACADEMY}</th>
                {FUNNEL_COLUMNS.map((segment) => <th key={segment} className="whitespace-nowrap px-3 py-2 text-right">{COMPARISON_LABELS[segment]}</th>)}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {FUNNEL_STEPS.map((step, index) => (
                <tr key={step.key} className="border-t border-slate-100">
                  <td className="px-4 py-2"><span className="font-medium text-slate-800">{step.label}</span>{step.hint && <p className="text-[11px] text-slate-400">{step.hint}</p>}</td>
                  <td className="px-3 py-2"><Bar value={step.value(academy)} max={academy.applications} /></td>
                  {FUNNEL_COLUMNS.map((segment) => {
                    const row = bySegment[segment];
                    const value = step.value(row);
                    const previous = index === 0 ? value : FUNNEL_STEPS[index - 1]!.value(row);
                    return (
                      <td key={segment} className="whitespace-nowrap px-3 py-2 text-right">
                        <span className="font-semibold text-slate-900">{value}</span>
                        {index > 0 && <span className="ml-1.5 text-[11px] text-slate-400">{pct(value, previous)}</span>}
                        {step.rejected && (
                          <p className="text-[11px]">
                            <span className={step.rejected(row) ? "text-rose-600" : "text-slate-300"}>✗ {step.rejected(row)} rejected</span>
                            {step.noShow && step.noShow(row) > 0 && <span className="text-violet-700"> · {step.noShow(row)} did not attend</span>}
                          </p>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Company rounds: attended → cleared"
        description="Rounds grouped by type across drives: assessment, technical rounds (TR1, TR2…), managerial (MR), HR. The % is cleared ÷ attended."
      >
        {data.companyRounds.length === 0 ? (
          <p className="px-4 py-4 text-xs text-slate-500">No company round results imported yet. They appear here once company sheets with round outcomes are imported.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr><th className="px-4 py-2">Round</th>{FUNNEL_COLUMNS.map((segment) => <th key={segment} className="whitespace-nowrap px-3 py-2 text-right">{COMPARISON_LABELS[segment]}</th>)}</tr>
              </thead>
              <tbody className="tabular-nums">
                {data.companyRounds.map((round) => (
                  <tr key={round.label} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-800">{round.label}</td>
                    {FUNNEL_COLUMNS.map((segment) => {
                      const r = round.bySegment[segment];
                      return (
                        <td key={segment} className="whitespace-nowrap px-3 py-2 text-right" title={`${r.rejected} rejected · ${r.noShow} no-show · ${r.scheduled} scheduled`}>
                          {r.appeared} → <span className="font-semibold text-emerald-700">{r.cleared}</span> <span className="text-[11px] text-slate-400">{pct(r.cleared, r.appeared)}</span>
                          <p className="text-[11px]">
                            <span className={r.rejected ? "text-rose-600" : "text-slate-300"}>✗ {r.rejected} rejected</span>
                            {r.noShow > 0 && <span className="text-violet-700"> · {r.noShow} no-show</span>}
                          </p>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function SegmentsTab({ data, filters }: { data: AcademyInsights; filters: AcademyFilters }) {
  const header = ["Group", "Students", "Applications", "Applications per student", "Students interviewed", "Interviews attended", "Students selected", "Selected % of interviewed", "Selected % of students", "Final shortlist", "Shared"];
  const rows = data.segments.map((row) => [
    COMPARISON_LABELS[row.segment], row.students, row.applications, row.students ? (row.applications / row.students).toFixed(1) : "—",
    row.studentsInterviewed, row.interviews, row.studentsSelected, pct(row.studentsSelected, row.studentsInterviewed), pct(row.studentsSelected, row.students),
    row.finalShortlisted, row.shared,
  ]);
  return (
    <Section
      title="Students, not applications: interviews vs selections"
      description="Here a student counts once however many drives they were in. Tier 1 = assessed-pool bucket A."
      action={<CsvButton onClick={() => downloadCsv(csvName("segments", filters), header, rows)} />}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
            <tr>{header.map((label, index) => <th key={label} className={`whitespace-nowrap px-3 py-2 ${index === 0 ? "px-4" : "text-right"}`}>{label}</th>)}</tr>
          </thead>
          <tbody className="tabular-nums">
            {data.segments.map((row) => (
              <tr key={row.segment} className={`border-t border-slate-100 ${row.segment === "OVERALL" ? "bg-slate-50/50" : ""}`}>
                <td className="px-4 py-2 font-medium text-slate-800">{COMPARISON_LABELS[row.segment]}</td>
                <td className="px-3 py-2 text-right">{num(row.students)}</td>
                <td className="px-3 py-2 text-right">{num(row.applications)}</td>
                <td className="px-3 py-2 text-right">{row.students ? (row.applications / row.students).toFixed(1) : "—"}</td>
                <td className="px-3 py-2 text-right">{num(row.studentsInterviewed)}</td>
                <td className="px-3 py-2 text-right">{num(row.interviews)}</td>
                <td className="px-3 py-2 text-right">{num(row.studentsSelected, "font-semibold text-emerald-700")}</td>
                <td className="px-3 py-2 text-right font-medium">{pct(row.studentsSelected, row.studentsInterviewed)}</td>
                <td className="px-3 py-2 text-right">{pct(row.studentsSelected, row.students)}</td>
                <td className="px-3 py-2 text-right">{num(row.finalShortlisted)}</td>
                <td className="px-3 py-2 text-right">{num(row.shared)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ReasonsTab({ data, filters }: { data: AcademyInsights; filters: AcademyFilters }) {
  const total = data.rejectionBuckets.reduce((sum, row) => sum + row.total, 0);
  const max = Math.max(0, ...data.rejectionBuckets.map((row) => row.total));
  const download = () => downloadCsv(csvName("internal-rejection-reasons", filters), ["Reason group", "Total", "Share", "Resume shortlist", "Screening", "Assignment", "Reason as written", "Count"],
    data.rejectionBuckets.flatMap((row) => (row.topReasons.length ? row.topReasons : [{ reason: "", count: 0 }]).map((reason, index) => [
      row.bucket, index === 0 ? row.total : "", index === 0 ? pct(row.total, total) : "", index === 0 ? row.byStage.RS : "", index === 0 ? row.byStage.SC : "", index === 0 ? row.byStage.AS : "", reason.reason, reason.count || "",
    ])));
  return (
    <Section
      title="Why our team rejected students (internal shortlisting)"
      description={<>Reasons typed in the job sheets, grouped by keywords. {total} internal rejections{data.rejectionsWithoutReason > 0 && <>, {data.rejectionsWithoutReason} with no reason written</>}.</>}
      action={<CsvButton onClick={download} disabled={total === 0} />}
    >
      {data.rejectionBuckets.length === 0 ? <EmptyState icon={SearchX} title="No internal rejections for these filters" /> : (
        <ul className="divide-y divide-slate-100">
          {data.rejectionBuckets.map((row) => (
            <li key={row.bucket} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,22rem)] md:items-center">
              <div>
                <p className="text-sm font-medium text-slate-800">{row.bucket}</p>
                <p className="text-xs text-slate-500 tabular-nums">Resume {row.byStage.RS} · Screening {row.byStage.SC} · Assignment {row.byStage.AS}</p>
              </div>
              <div className="flex items-center gap-3">
                <Bar value={row.total} max={max} />
                <span className="w-24 shrink-0 text-right text-sm tabular-nums"><b className="text-slate-900">{row.total}</b> <span className="text-xs text-slate-400">{pct(row.total, total)}</span></span>
              </div>
              <p className="text-xs text-slate-500">{row.topReasons.map((reason) => `${reason.reason} (${reason.count})`).join(" · ") || "—"}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function StackTab({ data, filters }: { data: AcademyInsights; filters: AcademyFilters }) {
  return (
    <div className="space-y-4">
      <Section
        title="Tech stack-wise conversion"
        description="Stack comes from the skills on each job request. A job with several skills counts under each one, so rows do not add up to the total."
        action={<CsvButton onClick={() => downloadCsv(csvName("tech-stack", filters), ["Skill", "Companies", "Jobs", ...CONVERSION_HEADER], data.byTechStack.map((row) => [row.skill, row.companies, row.jobs, ...conversionCsv(row)]))} />}
      >
        <ConversionTable leadHeader={["Skill", "Companies / jobs"]} rows={data.byTechStack.map((row) => ({
          ...row, key: row.skill,
          lead: <><td className="px-4 py-2 font-medium text-slate-800">{row.skill}</td><td className="px-4 py-2 text-slate-500">{row.companies} / {row.jobs}</td></>,
        }))} />
      </Section>
      <Section
        title="CTC range-wise conversion"
        description="Uses the CTC on the job request (upper bound of a range)."
        action={<CsvButton onClick={() => downloadCsv(csvName("ctc", filters), ["CTC", "Jobs", ...CONVERSION_HEADER], data.byCtcBand.map((row) => [row.band, row.jobs, ...conversionCsv(row)]))} />}
      >
        <ConversionTable leadHeader={["CTC", "Jobs"]} rows={data.byCtcBand.map((row) => ({
          ...row, key: row.band,
          lead: <><td className="px-4 py-2 font-medium text-slate-800">{row.band}</td><td className="px-4 py-2 text-slate-500">{row.jobs}</td></>,
        }))} />
      </Section>
    </div>
  );
}

function CompaniesTab({ data, filters }: { data: AcademyInsights; filters: AcademyFilters }) {
  const download = () => downloadCsv(csvName("company-funnels", filters),
    ["Company", "Role", "Month", "CTC (LPA)", "Tech stack", "Company status", "Applied", "Passed resume shortlist", "Passed screening", "Passed assignment", "Final shortlist", "Shared", "Interviewed", "Selected", "Selected % of applied", "Rounds (attended → cleared)"],
    data.byJob.map((row) => [row.companyName, row.roleTitle, row.month, row.ctcLpa, row.skills, companyProcessLabel(row.phase), row.applications, row.resumeShortlisted, row.screeningCleared,
      row.assignmentCleared, row.finalShortlisted, row.shared, row.interviewed, row.selected, pct(row.selected, row.applications),
      row.rounds.map((round) => `${round.label}: ${round.appeared}→${round.cleared}`).join("; ")]));
  return (
    <Section
      title="Each company drive, step by step"
      description="How many applied, passed each of our steps, were shared, interviewed and selected, per drive."
      action={<CsvButton onClick={download} disabled={data.byJob.length === 0} />}
    >
      {data.byJob.length === 0 ? <EmptyState title="No drives for these filters" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Company / role</th><th className="px-3 py-2">Stack · CTC</th>
                {["Applied", "Resume shortlist", "Screening", "Assignment", "Final shortlist", "Shared", "Interviewed", "Selected"].map((label) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
                <th className="px-3 py-2">Company rounds</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data.byJob.map((row) => (
                <tr key={row.jobRequestId} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2">
                    <Link to={`/job-requests/${row.jobRequestId}`} className="font-medium text-slate-800 hover:text-indigo-700">{row.companyName}</Link>
                    <p className="text-xs text-slate-500">{row.roleTitle} · {monthLabel(row.month)}</p>
                    <p className="text-[11px] text-slate-400">{companyProcessLabel(row.phase)}</p>
                  </td>
                  <td className="max-w-56 px-3 py-2 text-xs text-slate-600">{row.skills ?? <span className="text-slate-300">No skills</span>}<p className="text-slate-400">{row.ctcLpa !== null ? `${row.ctcLpa} LPA` : "CTC not entered"}</p></td>
                  <td className="px-3 py-2 text-right">{num(row.applications)}</td>
                  <td className="px-3 py-2 text-right">{num(row.resumeShortlisted)}</td>
                  <td className="px-3 py-2 text-right">{num(row.screeningCleared)}</td>
                  <td className="px-3 py-2 text-right">{num(row.assignmentCleared)}</td>
                  <td className="px-3 py-2 text-right">{num(row.finalShortlisted)} <span className="text-[11px] text-slate-400">{pct(row.finalShortlisted, row.applications)}</span></td>
                  <td className="px-3 py-2 text-right">{num(row.shared)}</td>
                  <td className="px-3 py-2 text-right">{num(row.interviewed)}</td>
                  <td className="px-3 py-2 text-right">{num(row.selected, "font-semibold text-emerald-700")}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {row.rounds.length === 0 ? <span className="text-slate-300">—</span> : row.rounds.map((round) => (
                      <span key={round.label} className="mb-1 mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5">{round.label} {round.appeared}→{round.cleared}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function PoolTab({ data, filters }: { data: AcademyInsights; filters: AcademyFilters }) {
  const tiers = data.pool.totals ? [...data.pool.byTier, data.pool.totals] : [];
  const maxBand = Math.max(0, ...data.applicationsPerCandidate.map((row) => Math.max(row.academy, row.pool)));
  const header = ["Bucket", "Pool size", "Found in our candidates", "Applied", "0 applications", "Applied, 0 opportunities", "Got an opportunity", "Interviewed", "Selected", "Applications"];
  return (
    <div className="space-y-4">
      <Section
        title="Assessed pool coverage"
        description="One row per person in the assessed-pool sheet (Offline Pool Main + Competency Pool Main), matched to our candidates by mobile. Opportunity = made the final shortlist or was shared with a company."
        action={<CsvButton disabled={tiers.length === 0} onClick={() => downloadCsv(csvName("pool-coverage", filters), header, tiers.map((row) => [row.tier ?? "Total", row.total, row.matched, row.applied, row.zeroApplications, row.zeroOpportunity, row.withOpportunity, row.interviewed, row.selected, row.applications]))} />}
      >
        {tiers.length === 0 ? <EmptyState icon={UserRoundCheck} title="The assessed pool is empty" description="Sync or import it on the Assessed pool page." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>{header.map((label, index) => <th key={label} className={`whitespace-nowrap px-3 py-2 ${index === 0 ? "px-4" : "text-right"}`}>{label}</th>)}</tr>
              </thead>
              <tbody className="tabular-nums">
                {tiers.map((row) => (
                  <tr key={row.tier ?? "total"} className={`border-t border-slate-100 ${row.tier === null ? "bg-slate-50/60 font-semibold" : ""}`}>
                    <td className="px-4 py-2 text-slate-800">{row.tier === null ? "Total" : row.tier === "A" ? "A · Tier 1" : row.tier}</td>
                    <td className="px-3 py-2 text-right">{row.total}</td>
                    <td className="px-3 py-2 text-right">{row.matched}</td>
                    <td className="px-3 py-2 text-right">{row.applied} <span className="text-[11px] font-normal text-slate-400">{pct(row.applied, row.total)}</span></td>
                    <td className="px-3 py-2 text-right text-amber-700">{row.zeroApplications}</td>
                    <td className="px-3 py-2 text-right text-rose-600">{row.zeroOpportunity}</td>
                    <td className="px-3 py-2 text-right">{row.withOpportunity}</td>
                    <td className="px-3 py-2 text-right">{row.interviewed}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{row.selected}</td>
                    <td className="px-3 py-2 text-right">{row.applications}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Applications per candidate"
        description="How many drives each person applied to in the period. Academy = every academy candidate we hold; pool = people in the assessed-pool sheet."
        action={<CsvButton onClick={() => downloadCsv(csvName("applications-per-candidate", filters), ["Applications", "Academy candidates", "Assessed pool"], data.applicationsPerCandidate.map((row) => [row.band, row.academy, row.pool]))} />}
      >
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">Applications</th><th className="px-3 py-2 text-right">Academy</th><th className="w-1/3 px-3 py-2" /><th className="px-3 py-2 text-right">Assessed pool</th><th className="w-1/3 px-3 py-2" /></tr>
          </thead>
          <tbody className="tabular-nums">
            {data.applicationsPerCandidate.map((row) => (
              <tr key={row.band} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{row.band}</td>
                <td className="px-3 py-2 text-right">{row.academy}</td>
                <td className="px-3 py-2"><Bar value={row.academy} max={maxBand} /></td>
                <td className="px-3 py-2 text-right">{row.pool}</td>
                <td className="px-3 py-2"><Bar value={row.pool} max={maxBand} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

    </div>
  );
}

function RsaTab({ data, filters }: { data: AcademyInsights; filters: AcademyFilters }) {
  const c = data.concluded;
  const download = () => downloadCsv(csvName("concluded-rsa", filters),
    ["Company", "Role", "Company status", "Process ended", "Shared", "Selected", "Not selected", "RSA done", "RSA in progress", "RSA not started", "RSA statuses"],
    c.jobs.map((row) => [row.companyName, row.roleTitle, companyProcessLabel(row.phase), row.processEndDate, row.shared, row.selected, row.notSelected, row.rsaDone, row.rsaOpen, row.rsaNotStarted,
      row.rsaStatuses.map((status) => `${status.label ?? "—"}: ${status.count}`).join("; ")]));
  return (
    <Section
      title="Concluded drives vs RSA done"
      description="Concluded = company status “Process done – hired / not hired”. Students to review = shared with the company and not selected. RSA counts as done when its status is marked as done in the Guidance & RSA status list."
      action={<CsvButton onClick={download} disabled={c.jobs.length === 0} />}
    >
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Concluded companies" value={c.companies} hint={`${c.jobCount} drives`} icon={ClipboardCheck} tone="slate" />
        <KpiCard label="RSA complete" value={c.rsaComplete} hint={`${c.rsaPartial} partly done · ${c.nothingToReview} nobody to review`} icon={Award} tone="emerald" />
        <KpiCard label="RSA not started" value={c.rsaNotDone} hint="Drives with students to review and no RSA done" icon={UserX} tone="rose" />
        <KpiCard label="Students reviewed" value={`${c.studentsReviewed} / ${c.studentsToReview}`} hint={`${pct(c.studentsReviewed, c.studentsToReview)} of students to review`} icon={GraduationCap} tone="sky" />
      </div>
      {c.jobs.length === 0 ? <EmptyState title="No concluded drives in this period" description="Drives appear here once their company status is set to Process done." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">Company / role</th><th className="px-3 py-2">Ended</th>{["Shared", "Selected", "To review", "RSA done", "In progress", "Not started"].map((label) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}<th className="px-3 py-2">RSA statuses</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {c.jobs.map((row) => (
                <tr key={row.jobRequestId} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2"><Link to={`/job-requests/${row.jobRequestId}`} className="font-medium text-slate-800 hover:text-indigo-700">{row.companyName}</Link><p className="text-xs text-slate-500">{row.roleTitle} · {companyProcessLabel(row.phase)}</p></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{row.processEndDate ? format(new Date(`${row.processEndDate}T00:00:00`), "d MMM yyyy") : "—"}</td>
                  <td className="px-3 py-2 text-right">{num(row.shared)}</td>
                  <td className="px-3 py-2 text-right">{num(row.selected, "text-emerald-700")}</td>
                  <td className="px-3 py-2 text-right font-medium">{num(row.notSelected)}</td>
                  <td className="px-3 py-2 text-right">{num(row.rsaDone, "font-semibold text-emerald-700")}</td>
                  <td className="px-3 py-2 text-right">{num(row.rsaOpen, "text-amber-700")}</td>
                  <td className="px-3 py-2 text-right">{num(row.rsaNotStarted, "text-rose-600")}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.rsaStatuses.map((status) => `${status.label} ${status.count}`).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────────── Page ─────────────────────────────────

export function AcademyPage() {
  const [filters, setFilters] = useState<AcademyFilters>({});
  const { can } = usePermissions();
  const [tab, setTab] = useState(() => (can("candidate:read") ? "students" : "funnel"));
  const set = (patch: Partial<AcademyFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const lastMonth = useMemo(() => format(subMonths(new Date(), 1), "yyyy-MM"), []);
  const overview = useQuery({ queryKey: ["academy-insights", "overview", filters], queryFn: () => academyInsightsApi.overview(filters), placeholderData: keepPreviousData });
  const categoryLabel = CATEGORY_OPTIONS[filters.academyCategory ?? "ACADEMY"];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Review meet · PSM"
        title="Academy & assessed pool"
        description="Find any Academy or assessed-pool student, see how far they got, and why they were rejected."
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="grid gap-1 text-xs text-slate-500">Date
          <Select value={filters.dateBy ?? "requested"} onValueChange={(value) => set({ dateBy: value === "requested" ? undefined : value as InsightDateBasis })}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="requested">Job requested</SelectItem><SelectItem value="processEnd">Process ended</SelectItem></SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">From<Input type="month" value={filters.from ?? ""} onChange={(event) => set({ from: event.target.value || undefined })} className="h-9 w-40" /></label>
        <label className="grid gap-1 text-xs text-slate-500">To<Input type="month" value={filters.to ?? ""} onChange={(event) => set({ to: event.target.value || undefined })} className="h-9 w-40" /></label>
        <Button size="sm" variant="outline" className="h-9" onClick={() => set({ from: lastMonth, to: lastMonth })}>Last month</Button>
        <label className="grid gap-1 text-xs text-slate-500">Students
          <Select value={filters.academyCategory ?? "ACADEMY"} onValueChange={(value) => set({ academyCategory: value === "ACADEMY" ? undefined : value as AcademyCategory })}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(CATEGORY_OPTIONS) as AcademyCategory[]).map((key) => <SelectItem key={key} value={key}>{CATEGORY_OPTIONS[key]}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="grid gap-1 text-xs text-slate-500">Segment
          <Select value={filters.segment ?? "ALL"} onValueChange={(value) => set({ segment: value === "ALL" ? undefined : value as AcademySegment })}>
            <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(SEGMENT_OPTIONS) as AcademySegment[]).map((key) => <SelectItem key={key} value={key}>{SEGMENT_OPTIONS[key]}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {Object.values(filters).some(Boolean) && <Button size="sm" variant="ghost" className="h-9" onClick={() => setFilters({})}>Reset</Button>}
        <p className="flex w-full items-start gap-1.5 text-[11px] text-slate-500">
          <Info size={12} className="mt-0.5 shrink-0" />
          Assessed pool = students in the Offline Pool Main or Competency Pool Main tab (matched by mobile). Tier 1 = bucket A.
          “Segment” narrows every tab except the step-by-step comparison, which always shows each group side by side.
        </p>
      </Card>

      {overview.isPending ? <Card><LoadingRows rows={6} /></Card> : overview.error ? <Card><ErrorState error={overview.error} onRetry={() => void overview.refetch()} /></Card> : (() => {
        const data = overview.data;
        const academy = data.segments.find((row) => row.segment === "ACADEMY")!;
        const pool = data.pool.totals;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label={`${categoryLabel} students who applied`} value={academy.students} hint={`${academy.applications} applications · ${academy.students ? (academy.applications / academy.students).toFixed(1) : "0"} per student`} icon={Users} />
              <KpiCard label={`${categoryLabel} selected`} value={academy.studentsSelected} hint={`${academy.studentsInterviewed} interviewed · ${pct(academy.studentsSelected, academy.studentsInterviewed)} interview → selection`} icon={Award} tone="emerald" />
              <KpiCard label="Assessed pool at 0 applications" value={pool?.zeroApplications ?? 0} hint={pool ? `of ${pool.total} in the pool · ${pool.applied} applied` : "Pool is empty"} icon={UserX} tone="amber" />
              <KpiCard label="Pool applied, never shortlisted or shared" value={pool?.zeroOpportunity ?? 0} hint={pool ? `${pool.withOpportunity} made the final shortlist or were shared · ${pool.selected} selected` : ""} icon={UserRoundCheck} tone="rose" />
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
                {can("candidate:read") && <TabsTrigger value="students">Students</TabsTrigger>}
                <TabsTrigger value="funnel">Step by step</TabsTrigger>
                <TabsTrigger value="reasons">Why students are rejected</TabsTrigger>
                <TabsTrigger value="companies">By company ({data.byJob.length})</TabsTrigger>
                <TabsTrigger value="pool">Assessed pool</TabsTrigger>
                <TabsTrigger value="stack">Tech stack & salary</TabsTrigger>
                <TabsTrigger value="rsa">Finished drives & RSA</TabsTrigger>
              </TabsList>
              {can("candidate:read") && <TabsContent value="students"><StudentsPanel filters={filters} /></TabsContent>}
              <TabsContent value="funnel"><div className="space-y-4"><FunnelTab data={data} filters={filters} /><SegmentsTab data={data} filters={filters} /></div></TabsContent>
              <TabsContent value="reasons"><div className="space-y-4"><CompanyReasonsPanel filters={filters} /><ReasonsTab data={data} filters={filters} /></div></TabsContent>
              <TabsContent value="stack"><StackTab data={data} filters={filters} /></TabsContent>
              <TabsContent value="companies"><CompaniesTab data={data} filters={filters} /></TabsContent>
              <TabsContent value="pool"><PoolTab data={data} filters={filters} /></TabsContent>
              <TabsContent value="rsa"><RsaTab data={data} filters={filters} /></TabsContent>
            </Tabs>
          </>
        );
      })()}
    </div>
  );
}
