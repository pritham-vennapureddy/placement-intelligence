import { z } from "zod";

export const teamIdParamsSchema = z.object({ teamId: z.uuid() });

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export const createUserSchema = z.object({
  email: z.email().max(254),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128),
  role: z.enum(["MANAGER", "PSM"]),
  teamId: z.uuid().optional(),
});

export const teamMembersSchema = z.object({
  teamLeadId: z.uuid().nullable(),
  psmIds: z.array(z.uuid()).max(200),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type TeamMembersInput = z.infer<typeof teamMembersSchema>;
