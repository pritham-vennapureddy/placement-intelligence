import { randomInt } from "node:crypto";
import { hash } from "bcryptjs";
import { inTransaction } from "../../db.js";
import { ApiError } from "../../utils/api-error.js";
import { recordAudit, type AuditContext } from "../audit/audit.service.js";
import { teamsRepository } from "./teams.repository.js";
import type { CreateUserInput, ResetPasswordInput, UpdateUserInput } from "./teams.validators.js";

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** 14 characters without look-alikes (0/O, 1/l/I), easy to read out to a colleague. */
export function generatePassword(length = 14): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");
}

const isAdminRecord = (user: { roles: { role: { code: string } }[] }) => user.roles.some(({ role }) => role.code === "ADMIN");

async function loadActiveUser(userId: string) {
  const user = await teamsRepository.findUser(userId);
  if (!user || !user.isActive) throw new ApiError(404, "USER_NOT_FOUND", "The user was not found.");
  return user;
}

/** Stops the workspace from being left with no administrator. */
async function assertNotLastAdmin(user: { roles: { role: { code: string } }[] }) {
  if (isAdminRecord(user) && (await teamsRepository.countActiveAdmins()) <= 1) {
    throw new ApiError(409, "LAST_ADMIN", "This is the only administrator. Make someone else an admin first.");
  }
}

export const teamsService = {
  listUsers() {
    return teamsRepository.listUsers();
  },

  async createUser(input: CreateUserInput, audit: AuditContext) {
    const email = input.email.toLowerCase();
    const existing = await teamsRepository.findByEmail(email);
    if (existing?.isActive) {
      throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }

    const passwordHash = await hash(input.password, 12);
    return inTransaction(async (transaction) => {
      const teamId = await teamsRepository.findOrCreateWorkspaceTeam(transaction, audit.actorId!);
      const details = { fullName: input.fullName, passwordHash, role: input.role, teamId };
      const user = existing
        ? await teamsRepository.reactivateUser(transaction, existing.id, details)
        : await teamsRepository.createUserWithRole(transaction, { email, ...details });
      await recordAudit(transaction, audit, {
        action: existing ? "USER_REACTIVATED" : "USER_CREATED",
        entityType: "User",
        entityId: user.id,
        metadata: { role: input.role, teamId },
      });
      return user;
    });
  },

  async updateUser(userId: string, input: UpdateUserInput, audit: AuditContext) {
    const user = await loadActiveUser(userId);
    const email = input.email?.toLowerCase();
    if (email && email !== user.email) {
      const taken = await teamsRepository.findByEmail(email);
      if (taken) throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }
    const currentRole = user.roles[0]?.role.code;
    if (input.role && input.role !== currentRole && input.role !== "ADMIN") {
      if (userId === audit.actorId) throw new ApiError(409, "OWN_ROLE", "You cannot remove your own admin role.");
      await assertNotLastAdmin(user);
    }
    return inTransaction(async (transaction) => {
      const updated = await teamsRepository.updateUser(transaction, userId, {
        ...(email && email !== user.email ? { email } : {}),
        ...(input.fullName && input.fullName !== user.fullName ? { fullName: input.fullName } : {}),
        ...(input.role && input.role !== currentRole ? { role: input.role } : {}),
      });
      // A new role or login email takes effect at the next sign-in.
      if ((input.role && input.role !== currentRole) || (email && email !== user.email)) {
        await teamsRepository.revokeSessions(transaction, userId);
      }
      await recordAudit(transaction, audit, {
        action: "USER_UPDATED",
        entityType: "User",
        entityId: userId,
        metadata: {
          ...(input.fullName && input.fullName !== user.fullName ? { fullName: { from: user.fullName, to: input.fullName } } : {}),
          ...(email && email !== user.email ? { emailChanged: true } : {}),
          ...(input.role && input.role !== currentRole ? { role: { from: currentRole ?? null, to: input.role } } : {}),
        },
      });
      return updated;
    });
  },

  /** Sets a new password (the admin's or a generated one) and returns it once so it can be shared. */
  async resetPassword(userId: string, input: ResetPasswordInput, audit: AuditContext) {
    await loadActiveUser(userId);
    const password = input.password ?? generatePassword();
    const passwordHash = await hash(password, 12);
    await inTransaction(async (transaction) => {
      await teamsRepository.setPassword(transaction, userId, passwordHash);
      await teamsRepository.revokeSessions(transaction, userId);
      await recordAudit(transaction, audit, { action: "USER_PASSWORD_RESET", entityType: "User", entityId: userId, metadata: { generated: !input.password } });
    });
    return { password };
  },

  /**
   * Removes the account's access. The record stays (companies, jobs, imports and
   * audit history point at it) but is hidden and can no longer sign in.
   */
  async deleteUser(userId: string, audit: AuditContext) {
    if (userId === audit.actorId) throw new ApiError(409, "OWN_ACCOUNT", "You cannot delete your own account.");
    const user = await loadActiveUser(userId);
    await assertNotLastAdmin(user);
    await inTransaction(async (transaction) => {
      await teamsRepository.deactivate(transaction, userId);
      await teamsRepository.revokeSessions(transaction, userId);
      await recordAudit(transaction, audit, { action: "USER_DELETED", entityType: "User", entityId: userId, metadata: { role: user.roles[0]?.role.code ?? null } });
    });
    return { ok: true };
  },
};
