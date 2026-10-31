import { useQuery } from "@tanstack/react-query";
import { Award, BriefcaseBusiness, CheckCircle2, ClipboardCheck, Send, Users } from "lucide-react";
import { useDashboardFilters } from "../hooks/use-dashboard-filters";
import { dashboardApi } from "../services/api";
import { KpiCard } from "./kpi-card";
import { Card } from "./ui/card";

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** Placement funnel counted from candidate records; follows the dashboard filters. */
export function LiveFunnel() {
  const { filters } = useDashboardFilters();
  const summary = useQuery({ queryKey: ["dashboard", "summary", filters], queryFn: () => dashboardApi.getSummary(filters) });
  const funnel = summary.data?.funnel;
  const loading = summary.isPending;

  const steps = funnel
    ? [
      { label: "Applications (TA)", value: funnel.applications, color: "bg-indigo-500" },
      { label: "Resume shortlist (RS)", value: funnel.resumeShortlisted, color: "bg-violet-500" },
      { label: "Screening (SC)", value: funnel.screeningShortlisted, color: "bg-sky-500" },
      { label: "Assignment (AS)", value: funnel.assignmentShortlisted, color: "bg-cyan-500" },
      { label: "Final shortlist (SP)", value: funnel.finalShortlisted, color: "bg-teal-500" },
      { label: "Nominated to company", value: funnel.nominated, color: "bg-emerald-500" },
      { label: "Selected by company", value: funnel.selected, color: "bg-emerald-600" },
      { label: "Offer accepted", value: funnel.offersAccepted, color: "bg-green-600" },
      { label: "Joined", value: funnel.joined, color: "bg-green-700" },
    ]
    : [];
  const top = Math.max(1, steps[0]?.value ?? 1);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Placement funnel</h2>
        <p className="mt-0.5 text-xs text-slate-400">Counted from candidate records for the job requests you can see</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="Candidates" value={funnel?.candidates} icon={Users} loading={loading} />
        <KpiCard label="Applications" value={funnel?.applications} icon={BriefcaseBusiness} tone="sky" loading={loading} />
        <KpiCard label="Final shortlisted" value={funnel?.finalShortlisted} icon={ClipboardCheck} tone="amber" loading={loading} />
        <KpiCard label="Nominated" value={funnel?.nominated} icon={Send} tone="slate" loading={loading} />
        <KpiCard label="Selected" value={funnel?.selected} icon={Award} tone="emerald" loading={loading}
          {...(funnel ? { hint: `${funnel.offersReleased} offers released` } : {})} />
        <KpiCard label="Joined" value={funnel?.joined} icon={CheckCircle2} tone="emerald" loading={loading}
          {...(funnel ? { hint: `${percent(funnel.joined, funnel.selected)} of selected` } : {})} />
      </div>
      {funnel && funnel.applications > 0 && (
        <Card className="p-5">
          <ol className="space-y-2.5">
            {steps.map((step) => (
              <li key={step.label} className="grid grid-cols-[10rem_1fr_4.5rem] items-center gap-3 text-xs sm:grid-cols-[12rem_1fr_5rem]">
                <span className="text-slate-600">{step.label}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <span className={`block h-full rounded-full ${step.color}`} style={{ width: `${Math.max(step.value ? 2 : 0, (step.value / top) * 100)}%` }} />
                </span>
                <span className="text-right"><strong className="text-slate-800">{step.value}</strong> <span className="text-slate-400">{percent(step.value, top)}</span></span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
