import type { MonthlyStudent } from "../../types/pulse";
import { applicationEnded, INTERNAL, INTERNAL_LABELS, type BoardRow, type Internal } from "./potential-board";

/**
 * Student funnel over the potential list's drives: our shortlisting (resume,
 * screening, assignment, final shortlist), sharing, each company round, and
 * selection. Counted per application ("by company") or per unique student.
 *
 * Two real-world cases are handled per job:
 * - A job may skip a stage (no resume shortlist, no screening…). A stage only
 *   applies to a job that recorded it, so nobody "fails" a stage that never ran.
 * - Students can reach the company without applying (added from the company
 *   sheet). They skip our shortlisting and join the funnel at "Shared".
 */

export type StageKey = string;
export interface Stage { key: StageKey; label: string; group: "ours" | "company" | "result" }
export type StopKind = "rejected" | "noShow" | "waiting" | "ended" | "selected";
export type FunnelMode = "applications" | "unique";

const passedAt = (person: MonthlyStudent, stage: Internal) =>
  stage === "resume" ? person.passed.resume : stage === "screening" ? person.passed.screening : stage === "assignment" ? person.passed.assignment : person.passed.finalShortlist;

interface AppFacts { reached: boolean; cleared: boolean; rejected: boolean; noShow: boolean }
/** Returned (this exact object) when a stage does not apply to the application at all. */
const NONE: AppFacts = Object.freeze({ reached: false, cleared: false, rejected: false, noShow: false });

export type FactsOf = (person: MonthlyStudent, key: StageKey) => AppFacts;

/** Which of our stages each job ran, in order (none = we did no shortlisting for it). */
function internalStagesByJob(rows: BoardRow[]): Map<string, Internal[]> {
  return new Map(rows.map((row) => [row.jobRequestId, row.stagesRun]));
}

/** What happened to one application at one stage, given the stages its job ran. */
export function factsFor(rows: BoardRow[]): FactsOf {
  const byJob = internalStagesByJob(rows);
  return (person, key) => {
    const own = byJob.get(person.jobRequestId) ?? [];
    const cleared = (stage: Internal) => passedAt(person, stage) || person.shared;
    if (key === "applied") return person.fromCompanySheet ? NONE : { reached: true, cleared: true, rejected: false, noShow: false };
    if (key === "direct") return person.fromCompanySheet ? { reached: true, cleared: true, rejected: false, noShow: false } : NONE;
    if ((INTERNAL as readonly string[]).includes(key)) {
      const stage = key as Internal;
      const at = own.indexOf(stage);
      if (person.fromCompanySheet || at < 0) return NONE;
      const reached = at === 0 || cleared(own[at - 1]!);
      const done = cleared(stage);
      const rejected = !done && (stage === "resume" ? person.rejectedAt.resume : stage === "screening" ? person.rejectedAt.screening : stage === "assignment" ? person.rejectedAt.assignment : false);
      const noShow = stage === "screening" && !done && !rejected && person.rejectedAt.screeningNoShow;
      return { reached, cleared: done, rejected, noShow };
    }
    if (key === "shared") {
      const reached = person.fromCompanySheet || own.length === 0 || cleared(own[own.length - 1]!);
      // Rejected by the company with no round recorded counts here.
      const rejected = person.shared && person.pipelineStatus === "REJECTED" && person.rounds.length === 0;
      return { reached, cleared: person.shared && !rejected, rejected, noShow: false };
    }
    if (key === "selected") return { reached: person.selected, cleared: person.selected, rejected: false, noShow: false };
    if (key.startsWith("round:")) {
      const round = person.rounds.find((item) => item.name === key.slice(6));
      if (!round) return NONE;
      return { reached: round.outcome !== "SCHEDULED", cleared: round.outcome === "CLEARED", rejected: round.outcome === "REJECTED", noShow: round.outcome === "NO_SHOW" };
    }
    return NONE;
  };
}

/** Stages for these drives: applied / added from the company sheet, the stages any job ran, sharing, every company round, selected. */
export function stagesFor(rows: BoardRow[], people: MonthlyStudent[]): Stage[] {
  const byJob = internalStagesByJob(rows);
  const ran = new Set([...byJob.values()].flat());
  const rounds = new Map<string, number>();
  for (const row of rows) (row.drive?.rounds ?? []).forEach((round, at) => rounds.set(round.name, Math.min(rounds.get(round.name) ?? Infinity, at)));
  for (const person of people) for (const round of person.rounds) if (!rounds.has(round.name)) rounds.set(round.name, round.sequence);
  const companyRounds = [...rounds].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).map(([name]) => ({ key: `round:${name}`, label: name, group: "company" as const }));
  return [
    ...(people.some((person) => !person.fromCompanySheet) ? [{ key: "applied", label: "Applied", group: "ours" as const }] : []),
    ...INTERNAL.filter((stage) => ran.has(stage)).map((stage) => ({ key: stage, label: INTERNAL_LABELS[stage], group: "ours" as const })),
    ...(people.some((person) => person.fromCompanySheet) ? [{ key: "direct", label: "Added from company sheet (did not apply)", group: "company" as const }] : []),
    { key: "shared", label: "Shared with company", group: "company" },
    ...companyRounds,
    { key: "selected", label: "Selected", group: "result" },
  ];
}

export interface Stop { index: number; stage: Stage; kind: StopKind; label: string }

const STOP_RANK: Record<StopKind, number> = { selected: 4, waiting: 3, ended: 2, noShow: 1, rejected: 0 };

/**
 * Where one application stopped: the first stage that applies to it (its job's
 * stages and rounds) that it has not cleared. Rejected or missed there, still
 * waiting for it, or the drive ended before it.
 */
function stopOf(person: MonthlyStudent, stages: Stage[], facts: FactsOf, jobRounds: Set<string>, driveOver: boolean, ownStages: Internal[]): Stop {
  const mine = stages.map((stage, index) => ({ stage, index })).filter(({ stage }) => {
    if (stage.key === "applied" || stage.key === "direct") return false;
    if (stage.group === "ours") return facts(person, stage.key) !== NONE;
    if (stage.key.startsWith("round:")) return jobRounds.has(stage.label) || person.rounds.some((round) => round.name === stage.label);
    return true;
  });
  const first = mine.find(({ stage }) => !facts(person, stage.key).cleared) ?? mine[mine.length - 1]!;
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
  // No shortlisting by us on this drive: the company sheet alone decides who goes ahead.
  else if (stage.key === "shared" && !person.fromCompanySheet && !ownStages.length) label = ended ? "Not in company sheet (no shortlisting by us)" : "Not in company sheet yet (no shortlisting by us)";
  else if (stage.key === "shared") label = person.fromCompanySheet ? "In company sheet, not submitted" : ended ? "Not shared with company (drive over)" : "Not shared with company yet";
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

export function funnelUnits(rows: BoardRow[], mode: FunnelMode, keep: (person: MonthlyStudent) => boolean): { stages: Stage[]; units: FunnelUnit[]; facts: FactsOf } {
  const over = new Map(rows.map((row) => [row.jobRequestId, row.state === "ENDED"]));
  const people = rows.flatMap((row) => row.people).filter(keep);
  const facts = factsFor(rows);
  const stages = stagesFor(rows, people);
  const jobRounds = new Map(rows.map((row) => [row.jobRequestId, new Set((row.drive?.rounds ?? []).map((round) => round.name))]));
  const ownStages = internalStagesByJob(rows);
  const perApp = people.map((person) => {
    const reached = new Set<StageKey>();
    const cleared = new Set<StageKey>();
    for (const stage of stages) {
      const fact = facts(person, stage.key);
      if (fact.reached) reached.add(stage.key);
      if (fact.cleared) cleared.add(stage.key);
    }
    return { key: person.applicationId, person, applications: [person], stop: stopOf(person, stages, facts, jobRounds.get(person.jobRequestId) ?? new Set(), over.get(person.jobRequestId) ?? false, ownStages.get(person.jobRequestId) ?? []), reached, cleared };
  });
  if (mode === "applications") return { stages, units: perApp, facts };

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
  return { stages, units, facts };
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
