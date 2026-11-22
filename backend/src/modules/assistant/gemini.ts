import { env } from "../../config/env.js";
import { ApiError } from "../../utils/api-error.js";

/** Gemini REST types, only the parts this app uses. */
export type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall: { name: string; args?: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GenerateInput = {
  system: string;
  contents: GeminiContent[];
  tools: FunctionDeclaration[];
  /** True forces a tool call (used for the first step so answers always come from data). */
  mustUseTool?: boolean;
  model?: string;
};

/**
 * One generateContent call. A busy or failing model is retried once, then the
 * fallback model is tried. Throws ApiError with a message fit for the chat.
 */
export async function generate(input: GenerateInput): Promise<GeminiContent> {
  if (!env.GEMINI_API_KEY) throw new ApiError(503, "ASSISTANT_NOT_CONFIGURED", "The assistant is not set up yet (no Gemini API key on the server).");
  const primary = input.model ?? env.GEMINI_MODEL;
  const attempts = [primary, primary, ...(env.GEMINI_FALLBACK_MODEL !== primary ? [env.GEMINI_FALLBACK_MODEL] : [])];
  let last: ApiError | null = null;
  for (const [index, model] of attempts.entries()) {
    if (index === 1) await new Promise((resolve) => setTimeout(resolve, 1500));
    const result = await callModel(model, input);
    if (!(result instanceof ApiError)) return result;
    last = result;
    if (!["ASSISTANT_UNAVAILABLE", "ASSISTANT_BUSY"].includes(result.code)) break;
  }
  throw last!;
}

async function callModel(model: string, input: GenerateInput): Promise<GeminiContent | ApiError> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.contents,
        tools: [{ functionDeclarations: input.tools }],
        toolConfig: { functionCallingConfig: { mode: input.mustUseTool ? "ANY" : "AUTO" } },
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return new ApiError(503, "ASSISTANT_UNAVAILABLE", "The AI service did not respond. Try again in a moment.");
  }
  const body = (await response.json().catch(() => ({}))) as {
    candidates?: { content?: GeminiContent; finishReason?: string }[];
    error?: { message?: string; status?: string };
  };
  if (response.status === 429) return new ApiError(429, "ASSISTANT_BUSY", "The assistant has hit Gemini's usage limit for now. Try again in a minute.");
  if (response.status >= 500) return new ApiError(503, "ASSISTANT_UNAVAILABLE", "The AI service is busy right now. Try again in a moment.");
  if (!response.ok) return new ApiError(502, "ASSISTANT_FAILED", `The AI service returned an error (${body.error?.status ?? response.status}).`);
  const content = body.candidates?.[0]?.content;
  if (!content?.parts?.length) {
    const reason = body.candidates?.[0]?.finishReason;
    return new ApiError(502, "ASSISTANT_EMPTY", reason === "SAFETY" ? "The AI service declined to answer that." : "The AI service gave no answer. Try rephrasing.");
  }
  return { role: "model", parts: content.parts };
}
