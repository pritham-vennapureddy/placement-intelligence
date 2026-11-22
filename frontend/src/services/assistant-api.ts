import { request } from "./api";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatReply {
  answer: string;
  /** The data the assistant looked at, e.g. get_month_overview. */
  toolsUsed: string[];
}

export const assistantApi = {
  async chat(messages: ChatMessage[]): Promise<ChatReply> {
    return (await request<{ data: ChatReply }>("/assistant/chat", { method: "POST", body: JSON.stringify({ messages }) })).data;
  },
};
