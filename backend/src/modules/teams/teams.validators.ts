import { z } from "zod";

const roleSchema = z.enum(["ADMIN", "MANAGER", "STAKEHOLDER", "EMPLOYEE"]);
const passwordSchema = z.string().min(12).max(128);

export const createUserSchema = z.object({
  email: z.email().max(254),
  fullName: z.string().trim().min(2).max(120),
  password: passwordSchema,
  role: roleSchema,
});

export const userParamsSchema = z.object({ userId: z.uuid() });

export const updateUserSchema = z
  .object({
    email: z.email().max(254).optional(),
    fullName: z.string().trim().min(2).max(120).optional(),
    role: roleSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), { message: "Nothing to change." });

/** Without a password the server generates one. Either way it is returned once so the admin can pass it on. */
export const resetPasswordSchema = z.object({ password: passwordSchema.optional() });

export type UserRoleCode = z.infer<typeof roleSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
