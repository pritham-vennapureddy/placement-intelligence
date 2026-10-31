import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";
import { env } from "../config/env.js";
import { ApiError } from "../utils/api-error.js";

export interface AuthenticatedUser {
  id: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header("authorization");
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(env.JWT_ACCESS_SECRET),
      { algorithms: ["HS256"] },
    );
    const roles = payload.roles;

    if (
      typeof payload.sub !== "string" ||
      !Array.isArray(roles) ||
      !roles.every((role): role is string => typeof role === "string")
    ) {
      throw new ApiError(401, "INVALID_ACCESS_TOKEN", "Your session is invalid.");
    }

    request.user = { id: payload.sub, roles };
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(401, "INVALID_ACCESS_TOKEN", "Your session is invalid.");
  }
}
