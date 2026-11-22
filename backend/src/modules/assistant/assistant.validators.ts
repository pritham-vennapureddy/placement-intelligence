import { z } from "zod";

/** The conversation so far, oldest first, ending with the user's new question. */
export const chatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) }))
    .min(1)
    .max(30)
    .refine((messages) => messages.at(-1)?.role === "user", { message: "The last message must be the question." })
    .refine((messages) => (messages.at(-1)?.content.length ?? 0) <= 2000, { message: "Keep the question under 2,000 characters." }),
});

export type ChatInput = z.infer<typeof chatSchema>;
