import { hasPermission, type Permission } from "@placement/shared";
import { prisma } from "../db.js";
import type { AuthenticatedUser } from "../middleware/authenticate.js";
import { ApiError } from "../utils/api-error.js";
import { isJobOwnerInScope, resolveDataScope } from "./data-scope.service.js";

/**
 * Loads a job request the user may see (404 otherwise, never revealing it
 * exists). With `permission`, also requires that permission for changes.
 */
export async function loadJobForUser(user: AuthenticatedUser, jobRequestId: string, permission?: Permission) {
  const [job, scope] = await Promise.all([
    prisma.jobRequest.findUnique({
      where: { id: jobRequestId },
      select: {
        id: true,
        jobId: true,
        roleTitle: true,
        status: true,
        companyId: true,
        psmOwnerId: true,
        archivedAt: true,
        company: { select: { id: true, name: true } },
        skills: { select: { skillId: true } },
      },
    }),
    resolveDataScope(user),
  ]);
  if (!job || job.archivedAt || !isJobOwnerInScope(scope, job.psmOwnerId)) {
    throw new ApiError(404, "JOB_REQUEST_NOT_FOUND", "The job request was not found.");
  }
  if (permission && !hasPermission(user.roles, permission)) {
    throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  }
  return { job, scope };
}

export type AccessibleJob = Awaited<ReturnType<typeof loadJobForUser>>["job"];
