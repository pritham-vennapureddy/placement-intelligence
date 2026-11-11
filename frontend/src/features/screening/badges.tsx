import {
  INTERVIEW_OUTCOME_LABELS,
  PIPELINE_STATUS_LABELS,
  STAGE_OUTCOME_LABELS,
  STAGE_STATUS_LABELS,
  type InterviewOutcome,
  type PipelineStatus,
  type StageOutcome,
  type StageStatus,
} from "@placement/shared";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../utils/cn";

const tone = {
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
} as const;

const stageStatusTone: Record<StageStatus, keyof typeof tone> = {
  NOT_STARTED: "slate",
  IN_PROGRESS: "sky",
  COMPLETED: "emerald",
  PARTIALLY_COMPLETED: "amber",
  NOT_CONDUCTED: "violet",
};

const outcomeTone: Record<StageOutcome, keyof typeof tone> = {
  PENDING: "slate",
  SELECTED: "emerald",
  REJECTED: "rose",
  ON_HOLD: "amber",
  NO_SHOW: "violet",
  WITHDRAWN: "slate",
};

const pipelineTone: Record<PipelineStatus, keyof typeof tone> = {
  NOT_SUBMITTED: "slate",
  IN_PROCESS: "sky",
  ON_HOLD: "amber",
  REJECTED: "rose",
  SELECTED: "emerald",
  OFFER_RELEASED: "indigo",
  OFFER_ACCEPTED: "indigo",
  OFFER_DECLINED: "rose",
  JOINED: "emerald",
  DROPPED: "slate",
};

const interviewTone: Record<InterviewOutcome, keyof typeof tone> = {
  SCHEDULED: "sky",
  CLEARED: "emerald",
  REJECTED: "rose",
  ON_HOLD: "amber",
  NO_SHOW: "violet",
  CANCELLED: "slate",
};

function Pill({ color, children, className }: { color: keyof typeof tone; children: string; className?: string | undefined }) {
  return <Badge variant="outline" className={cn(tone[color], "whitespace-nowrap", className)}>{children}</Badge>;
}

export const StageStatusBadge = ({ status }: { status: StageStatus }) => <Pill color={stageStatusTone[status]}>{STAGE_STATUS_LABELS[status]}</Pill>;
export const OutcomeBadge = ({ outcome }: { outcome: StageOutcome }) => <Pill color={outcomeTone[outcome]}>{STAGE_OUTCOME_LABELS[outcome]}</Pill>;
export const PipelineBadge = ({ status, className }: { status: PipelineStatus; className?: string }) => (
  <Pill color={pipelineTone[status]} className={className}>{PIPELINE_STATUS_LABELS[status]}</Pill>
);
export const InterviewBadge = ({ outcome }: { outcome: InterviewOutcome }) => (
  <Pill color={interviewTone[outcome]}>{outcome === "SCHEDULED" ? "In progress" : INTERVIEW_OUTCOME_LABELS[outcome]}</Pill>
);

export const CATEGORY_LABELS = { ACADEMY: "Academy", ACADEMY_INTENSIVE: "Academy Intensive", EXTERNAL: "External" } as const;
