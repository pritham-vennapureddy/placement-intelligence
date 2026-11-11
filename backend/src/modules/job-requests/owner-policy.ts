import { hasPermission } from "@placement/shared";
import { ApiError } from "../../utils/api-error.js";

export interface JobRequestOwnerActor {
  id: string;
  roles: readonly string[];
}

export function resolveJobRequestOwner(actor: JobRequestOwnerActor, requestedOwnerId?: string) {
  if (hasPermission(actor.roles, "job:assign")) {
    const isAdmin = actor.roles.includes("ADMIN");
    const isEmployee = actor.roles.includes("EMPLOYEE");
    if (!requestedOwnerId && !isEmployee && !isAdmin) {
      throw new ApiError(400, "EMPLOYEE_OWNER_REQUIRED", "Choose the employee who owns this job request.");
    }
    const ownerId = requestedOwnerId ?? actor.id;
    return { ownerId, adminSelfAssignment: isAdmin && ownerId === actor.id };
  }

  if (requestedOwnerId && requestedOwnerId !== actor.id) {
    throw new ApiError(403, "FORBIDDEN", "Only managers can assign a job request to someone else.");
  }
  return { ownerId: actor.id, adminSelfAssignment: false };
}
