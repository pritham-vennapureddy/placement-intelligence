import type { RequestHandler } from "express";
import { hasPermission, type Permission } from "@placement/shared";
import { ApiError } from "../utils/api-error.js";

/** Allows the request when the user holds every listed permission. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.user) {
      next(new ApiError(401, "UNAUTHENTICATED", "Sign in to continue."));
      return;
    }

    if (!permissions.every((permission) => hasPermission(request.user!.roles, permission))) {
      next(new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action."));
      return;
    }

    next();
  };
}
