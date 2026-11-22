import type { AuthenticatedUser } from "../../middleware/authenticate.js";
import { ApiError } from "../../utils/api-error.js";
import { createToolRunner, TOOL_DECLARATIONS } from "./assistant.tools.js";
import { generate, type GeminiContent, type GeminiPart } from "./gemini.js";
import type { ChatInput } from "./assistant.validators.js";

const MAX_TOOL_ROUNDS = 6;

function systemPrompt(today: string) {
  return `You are the placement team's data assistant inside the Placement Intelligence dashboard. Stakeholders and the team ask you about companies, job drives, students and placement results. Today is ${today} (India time); "this month" means ${today.slice(0, 7)}.

How to answer:
- Always get numbers from the tools; never guess or invent figures, names or companies. Only mention companies and students that appear in tool results.
- For anything about a month (companies in pipeline, openings, students shared / interviewed / in process, how a company's rounds went), use get_month_overview; use list_students for names; use get_insights for rejection reasons and longer trends; use get_placement_kpis for KPIs. If the tools do not have it, say so plainly and suggest where in the dashboard to look or what the team should record.
- Call several tools when a question needs it (e.g. search_jobs then get_drive_notes).
- Lead with the direct answer in one or two sentences, then the supporting numbers. Use short bullet points or a small markdown table for comparisons across companies or months. Keep it brief.
- Student counts from get_month_overview and list_students are unique students (a student in three companies counts once); say "unique" when it matters.
- Definitions used by the team:
  - "In the pipeline" for students means applied to a drive live that month (uniqueStudentsInPipeline_applied), not only shared. Report shared, interviewed and in process separately.
  - Internal process stages: TA = applied, RS = resume shortlist, SC = screening call, AS = assignment, SP = final shortlist (sent to the company).
  - Placement = a student the company selected, offered or who joined. Placements count in the month the student was hired (interview done date), not the job request month.
  - KPI 2 (% positions closed) and KPI 3 (% hired companies) only count jobs whose company process ended in the period. A null percentage means there is nothing to measure yet (say "not available yet, no process has ended"), not 0%.
  - Academy includes Intensive students; every assessed-pool student is an Academy student.
- When the user names a company, match it loosely (spelling, short forms).
- Never reveal phone numbers or email addresses (the tools do not return them).
- If the question is not about placement data, answer briefly or steer back to what you can help with.`;
}

/** Answers one chat turn, calling the data tools as Gemini asks for them. */
export const assistantService = {
  async chat(user: AuthenticatedUser, input: ChatInput & { model?: string }) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const contents: GeminiContent[] = input.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
    const runTool = createToolRunner(user);
    const used: string[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // The first step must look at data, so the answer never comes from the model's imagination.
      const reply = await generate({ system: systemPrompt(today), contents, tools: TOOL_DECLARATIONS, mustUseTool: round === 0, ...(input.model ? { model: input.model } : {}) });
      const calls = reply.parts.filter((part): part is Extract<GeminiPart, { functionCall: unknown }> => "functionCall" in part);
      if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
        const answer = reply.parts
          .filter((part): part is Extract<GeminiPart, { text: string }> => "text" in part && !part.thought)
          .map((part) => part.text)
          .join("")
          .trim();
        if (!answer) throw new ApiError(502, "ASSISTANT_EMPTY", "The assistant could not put an answer together. Try asking more specifically.");
        return { answer, toolsUsed: [...new Set(used)] };
      }
      // Send the model's turn back unchanged (it may carry thought signatures), then the tool results.
      contents.push(reply);
      const results = await Promise.all(calls.map(async ({ functionCall }) => {
        used.push(functionCall.name);
        return { functionResponse: { name: functionCall.name, response: await runTool(functionCall.name, functionCall.args ?? {}) } };
      }));
      contents.push({ role: "user", parts: results });
    }
    throw new ApiError(502, "ASSISTANT_EMPTY", "The assistant could not finish. Try a narrower question.");
  },
};
