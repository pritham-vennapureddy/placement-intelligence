import type { RequestHandler } from "express";
import { ApiError } from "../utils/api-error.js";

export function authorize(...allowedRoles: string[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.user) {
      next(new ApiError(401, "UNAUTHENTICATED", "Sign in to continue."));
      return;
    }

    if (!request.user.roles.some((role) => allowedRoles.includes(role))) {
      next(new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action."));
      return;
    }

    next();
  };
}
