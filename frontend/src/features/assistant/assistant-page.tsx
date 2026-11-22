import { useMutation } from "@tanstack/react-query";
import { Bot, Eraser, Send, Sparkles, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Textarea } from "../../components/ui/textarea";
import { assistantApi, type ChatMessage } from "../../services/assistant-api";
import { cn } from "../../utils/cn";
import { Markdown } from "./markdown";

/** Questions stakeholders typically ask in placement reviews. */
const SUGGESTIONS = [
  "How many unique Academy students are in the pipeline this month, and how many got interviews?",
  "Which companies are in the pipeline this month? Show openings and Academy students shared and in process.",
  "At which round are most Academy students getting rejected, company wise?",
  "Who are the Academy students still in a company process right now?",
  "What are our placement KPIs this month and how do they compare with last month?",
  "Which potential companies are confirmed or starting this month, and what did CRM say?",
  "Why are students getting rejected in our internal process (RS, SC, AS)?",
  "How many assessed-pool students got interviews this month and where are they now?",
];

const TOOL_LABELS: Record<string, string> = {
  get_month_overview: "monthly pipeline",
  list_students: "student list",
  get_placement_kpis: "placement KPIs",
  get_insights: "insights",
  search_jobs: "job requests",
  get_drive_notes: "CRM & RSA notes",
};

type Turn = ChatMessage & { toolsUsed?: string[]; failed?: boolean };
const STORAGE_KEY = "assistant-chat";

function loadTurns(): Turn[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as Turn[];
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/** "Ask the data": a chat that answers stakeholder questions from the dashboard's live data. */
export function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const ask = useMutation({
    mutationFn: (history: ChatMessage[]) => assistantApi.chat(history),
    onSuccess: (reply) => setTurns((current) => [...current, { role: "assistant", content: reply.answer, toolsUsed: reply.toolsUsed }]),
    onError: (error) => setTurns((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "Something went wrong.", failed: true }]),
  });

  const send = (question: string) => {
    const content = question.trim();
    if (!content || ask.isPending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setDraft("");
    // Failed replies are not part of the conversation; the last 20 turns are plenty of context.
    ask.mutate(next.filter((turn) => !turn.failed).slice(-20).map(({ role, content: text }) => ({ role, content: text })));
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Workspace"
        title="Ask the data"
        description="Ask what stakeholders ask: companies, drives, students, rounds and KPIs. Answers come from the dashboard's live data."
        actions={turns.length > 0 ? <Button size="sm" variant="outline" onClick={() => setTurns([])} disabled={ask.isPending}><Eraser size={14} /> New chat</Button> : undefined}
      />
      <Card className="flex min-h-[60vh] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
          {turns.length === 0 && (
            <div className="mx-auto max-w-3xl py-6 text-center">
              <Sparkles className="mx-auto text-indigo-500" size={28} />
              <p className="mt-2 text-sm font-semibold text-slate-800">What would you like to know?</p>
              <p className="mt-1 text-xs text-slate-500">Try one of these, or ask in your own words. Follow-up questions work too.</p>
              <div className="mt-5 grid gap-2 text-left sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => send(suggestion)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/50">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn, index) => (
            <div key={index} className={cn("flex gap-3", turn.role === "user" && "flex-row-reverse")}>
              <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", turn.role === "user" ? "bg-slate-200 text-slate-600" : "bg-indigo-100 text-indigo-700")}>
                {turn.role === "user" ? <User size={14} /> : <Bot size={14} />}
              </span>
              <div className={cn(
                "max-w-[85%] rounded-xl px-4 py-2.5",
                turn.role === "user" ? "bg-indigo-600 text-sm text-white" : turn.failed ? "border border-rose-200 bg-rose-50 text-sm text-rose-700" : "border border-slate-200 bg-white",
              )}>
                {turn.role === "assistant" && !turn.failed ? <Markdown text={turn.content} /> : <p className="whitespace-pre-wrap">{turn.content}</p>}
                {turn.toolsUsed && turn.toolsUsed.length > 0 && (
                  <p className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">From: {turn.toolsUsed.map((tool) => TOOL_LABELS[tool] ?? tool).join(", ")}</p>
                )}
              </div>
            </div>
          ))}
          {ask.isPending && (
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-700"><Bot size={14} /></span>
              <p className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500">Looking at the data…</p>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form className="flex items-end gap-2 border-t border-slate-100 p-3" onSubmit={(event) => { event.preventDefault(); send(draft); }}>
          <Textarea
            value={draft}
            rows={2}
            maxLength={2000}
            placeholder="Ask about companies, students, rounds or KPIs… (Enter to send, Shift+Enter for a new line)"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(draft); } }}
            className="min-h-[44px] resize-none"
            aria-label="Your question"
          />
          <Button type="submit" disabled={!draft.trim() || ask.isPending}><Send size={14} /> Ask</Button>
        </form>
      </Card>
      <p className="text-xs text-slate-400">Answers are generated by Google Gemini from dashboard data you can see. Check important numbers on the Monthly pipeline or Insights pages before sharing.</p>
    </div>
  );
}
