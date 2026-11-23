import type { MonthlyStudent } from "../../types/pulse";
import { applicationEnded, type BoardRow } from "./potential-board";

/**
 * Student funnel over the potential list's drives: our shortlisting (resume,
 * screening, assignment, final shortlist), sharing, each company round, and
 * selection. Counted per application ("by company") or per unique student.
 */

export type StageKey = string;
export interface Stage { key: StageKey; label: string; group: "ours" | "company" | "result" }
export type StopKind = "rejected" | "noShow" | "waiting" | "ended" | "selected";
export type FunnelMode = "applications" | "unique";

const OUR_STAGES: Stage[] = [
  { key: "applied", label: "Applied", group: "ours" },
  { key: "resume", label: "Resume shortlist", group: "ours" },
  { key: "screening", label: "Screening", group: "ours" },
  { key: "assignment", label: "Assignment", group: "ours" },
  { key: "final", label: "Final shortlist", group: "ours" },
  { key: "shared", label: "Shared with company", group: "company" },
];

interface AppFacts { reached: boolean; cleared: boolean; rejected: boolean; noShow: boolean }

/** What happened to one application at one stage. */
export function facts(person: MonthlyStudent, key: StageKey): AppFacts {
  const none = { reached: false, cleared: false, rejected: false, noShow: false };
  const resumeCleared = person.passed.resume || person.shared;
  const screeningCleared = person.passed.screening || person.shared;
  const assignmentCleared = person.passed.assignment || person.shared;
  const finalCleared = person.passed.finalShortlist || person.shared;
  switch (key) {
    case "applied": return { reached: true, cleared: true, rejected: false, noShow: false };
    case "resume": return { reached: true, cleared: resumeCleared, rejected: person.rejectedAt.resume && !resumeCleared, noShow: false };
    case "screening": return { reached: resumeCleared, cleared: screeningCleared, rejected: person.rejectedAt.screening && !screeningCleared, noShow: person.rejectedAt.screeningNoShow && !screeningCleared && !person.rejectedAt.screening };
    case "assignment": return { reached: screeningCleared, cleared: assignmentCleared, rejected: person.rejectedAt.assignment && !assignmentCleared, noShow: false };
    case "final": return { reached: assignmentCleared, cleared: finalCleared, rejected: false, noShow: false };
    // Rejected by the company with no round recorded counts here.
    case "shared": return { reached: finalCleared, cleared: person.shared && (person.rounds.length > 0 || person.pipelineStatus !== "REJECTED"), rejected: person.shared && person.pipelineStatus === "REJECTED" && person.rounds.length === 0, noShow: false };
    case "selected": return { reached: person.selected, cleared: person.selected, rejected: false, noShow: false };
  }
  if (key.startsWith("round:")) {
    const name = key.slice(6);
    const round = person.rounds.find((item) => item.name === name);
    if (!round) return none;
    return {
      reached: round.outcome !== "SCHEDULED",
      cleared: round.outcome === "CLEARED",
      rejected: round.outcome === "REJECTED",
      noShow: round.outcome === "NO_SHOW",
    };
  }
  return none;
}

/**
 * Stages for these drives: ours (screening, assignment and final shortlist only
 * when some drive records them), every company round of the drives (in each
 * job's order), then selected.
 */
export function stagesFor(rows: BoardRow[], people: MonthlyStudent[]): Stage[] {
  const rounds = new Map<string, number>();
  for (const row of rows) (row.drive?.rounds ?? []).forEach((round, at) => rounds.set(round.name, Math.min(rounds.get(round.name) ?? Infinity, at)));
  for (const person of people) for (const round of person.rounds) if (!rounds.has(round.name)) rounds.set(round.name, round.sequence);
  const companyRounds = [...rounds].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).map(([name]) => ({ key: `round:${name}`, label: name, group: "company" as const }));
  /** Signs that a drive actually ran the stage (later stages imply earlier passes, so those alone do not count). */
  const recorded: Record<string, (person: MonthlyStudent) => boolean> = {
    screening: (person) => person.rejectedAt.screening || person.rejectedAt.screeningNoShow || (person.passed.screening && !person.passed.assignment),
    assignment: (person) => person.rejectedAt.assignment || (person.passed.assignment && !person.passed.finalShortlist),
    final: (person) => person.passed.finalShortlist,
  };
  const ours = OUR_STAGES.filter((stage) => !recorded[stage.key] || people.some(recorded[stage.key]!));
  return [...ours, ...companyRounds, { key: "selected", label: "Selected", group: "result" }];
}

export interface Stop { index: number; stage: Stage; kind: StopKind; label: string }

const STOP_RANK: Record<StopKind, number> = { selected: 4, waiting: 3, ended: 2, noShow: 1, rejected: 0 };

/**
 * Where one application stopped: the first stage (of the ones its job has) it
 * has not cleared. Rejected or missed there, still waiting for it, or the drive
 * ended before it.
 */
function stopOf(person: MonthlyStudent, stages: Stage[], jobRounds: Set<string>, driveOver: boolean): Stop {
  const mine = stages.map((stage, index) => ({ stage, index }))
    .filter(({ stage }) => !stage.key.startsWith("round:") || jobRounds.has(stage.label) || person.rounds.some((round) => round.name === stage.label));
  const first = mine.find(({ stage }) => stage.key !== "applied" && !facts(person, stage.key).cleared) ?? mine[mine.length - 1]!;
  const { stage, index } = first;
  const fact = facts(person, stage.key);
  const ended = applicationEnded(person, driveOver);
  const kind: StopKind = person.selected ? "selected" : fact.rejected ? "rejected" : fact.noShow ? "noShow" : ended ? "ended" : "waiting";
  const name = stage.group === "ours" ? stage.label.toLowerCase() : stage.label;
  let label: string;
  if (kind === "selected") label = "Selected";
  else if (kind === "rejected") label = stage.key === "shared" ? "Rejected by company (round not recorded)" : stage.group === "ours" ? `Rejected at ${name}` : `Rejected by company at ${name}`;
  else if (kind === "noShow") label = `Missed ${name}`;
  else if (stage.key === "shared" && !fact.reached) label = ended ? "Not shortlisted for the company (drive over)" : "In our shortlisting";
  else if (stage.key === "shared") label = ended ? "On final shortlist, never shared" : "On final shortlist, not shared yet";
  else if (stage.key === "selected") label = ended ? "Cleared every round, not selected" : "Cleared every round, waiting for result";
  else if (stage.group === "company") {
    const scheduled = person.rounds.some((round) => round.name === stage.label && round.outcome === "SCHEDULED");
    label = ended ? `Company process over before ${name}` : scheduled ? `Scheduled for ${name}` : fact.reached ? `${name}: result awaited` : `Shared, waiting for ${name}`;
  } else label = ended ? `Not cleared at ${name} (drive over)` : `In ${name}`;
  return { index, stage, kind, label };
}

/** One row of the list: an application, or a unique student with all their applications. */
export interface FunnelUnit {
  key: string;
  person: MonthlyStudent;
  applications: MonthlyStudent[];
  stop: Stop;
  reached: Set<StageKey>;
  cleared: Set<StageKey>;
}

export function funnelUnits(rows: BoardRow[], mode: FunnelMode, keep: (person: MonthlyStudent) => boolean): { stages: Stage[]; units: FunnelUnit[] } {
  const over = new Map(rows.map((row) => [row.jobRequestId, row.state === "ENDED"]));
  const people = rows.flatMap((row) => row.people).filter(keep);
  const stages = stagesFor(rows, people);
  const jobRounds = new Map(rows.map((row) => [row.jobRequestId, new Set((row.drive?.rounds ?? []).map((round) => round.name))]));
  const perApp = people.map((person) => {
    const reached = new Set<StageKey>();
    const cleared = new Set<StageKey>();
    for (const stage of stages) {
      const fact = facts(person, stage.key);
      if (fact.reached) reached.add(stage.key);
      if (fact.cleared) cleared.add(stage.key);
    }
    return { key: person.applicationId, person, applications: [person], stop: stopOf(person, stages, jobRounds.get(person.jobRequestId) ?? new Set(), over.get(person.jobRequestId) ?? false), reached, cleared };
  });
  if (mode === "applications") return { stages, units: perApp };

  const byStudent = new Map<string, FunnelUnit[]>();
  for (const unit of perApp) byStudent.set(unit.person.candidateId, [...(byStudent.get(unit.person.candidateId) ?? []), unit]);
  const units = [...byStudent.values()].map((list) => {
    const best = [...list].sort((x, y) => y.stop.index - x.stop.index || STOP_RANK[y.stop.kind] - STOP_RANK[x.stop.kind])[0]!;
    return {
      key: best.person.candidateId,
      person: best.person,
      applications: list.sort((x, y) => y.stop.index - x.stop.index).map((unit) => unit.person),
      stop: best.stop,
      reached: new Set(list.flatMap((unit) => [...unit.reached])),
      cleared: new Set(list.flatMap((unit) => [...unit.cleared])),
    };
  });
  return { stages, units };
}

export interface StageCounts { reached: number; cleared: number; rejected: number; noShow: number; waiting: number; ended: number }

/**
 * Per stage: how many reached and cleared it, and how many stopped there
 * (rejected, missed it, still waiting, or the drive ended). In unique mode a
 * student stops where their furthest application stopped.
 */
export function stageCounts(stages: Stage[], units: FunnelUnit[]): Map<StageKey, StageCounts> {
  const counts = new Map(stages.map((stage) => [stage.key, { reached: 0, cleared: 0, rejected: 0, noShow: 0, waiting: 0, ended: 0 }]));
  for (const unit of units) {
    for (const key of unit.reached) counts.get(key)!.reached++;
    for (const key of unit.cleared) counts.get(key)!.cleared++;
    const at = counts.get(unit.stop.stage.key)!;
    if (unit.stop.kind === "rejected") at.rejected++;
    else if (unit.stop.kind === "noShow") at.noShow++;
    else if (unit.stop.kind === "waiting") at.waiting++;
    else if (unit.stop.kind === "ended") at.ended++;
  }
  return counts;
}

export type Pick = { stage: StageKey; what: "reached" | "cleared" | "rejected" | "noShow" | "waiting" | "ended" };

export function matchesPick(unit: FunnelUnit, pick: Pick | null) {
  if (!pick) return true;
  if (pick.what === "reached") return unit.reached.has(pick.stage);
  if (pick.what === "cleared") return unit.cleared.has(pick.stage);
  return unit.stop.stage.key === pick.stage && unit.stop.kind === pick.what;
}
