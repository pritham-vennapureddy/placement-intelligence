import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import { sendData, sendNoContent } from "../../utils/http.js";
import { auditContextFrom } from "../audit/audit.service.js";
import { authRepository } from "./auth.repository.js";
import { createAuthService } from "./auth.service.js";
import type { LoginInput } from "./auth.validators.js";

const authService = createAuthService(authRepository, {
  accessSecret: env.JWT_ACCESS_SECRET,
  refreshSecret: env.JWT_REFRESH_SECRET,
  accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  now: () => new Date(),
});

const REFRESH_COOKIE = "refreshToken";
const refreshCookie: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth",
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

function readRefreshCookie(request: Request): string | undefined {
  const value: unknown = request.cookies?.[REFRESH_COOKIE];
  return typeof value === "string" ? value : undefined;
}

export const authController = {
  async login(request: Request, response: Response): Promise<void> {
    const { email, password } = request.body as LoginInput;
    const { actorId: _actorId, ...audit } = auditContextFrom(request);
    const result = await authService.login(email, password, audit);
    response.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookie);
    sendData(response, { accessToken: result.accessToken, user: result.user });
  },

  async refresh(request: Request, response: Response): Promise<void> {
    const result = await authService.refresh(readRefreshCookie(request));
    response.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookie);
    sendData(response, { accessToken: result.accessToken, user: result.user });
  },

  async logout(request: Request, response: Response): Promise<void> {
    await authService.logout(readRefreshCookie(request));
    const { maxAge: _maxAge, ...clearOptions } = refreshCookie;
    response.clearCookie(REFRESH_COOKIE, clearOptions);
    sendNoContent(response);
  },

  async me(request: Request, response: Response): Promise<void> {
    const user = await authService.getCurrentUser(request.user!.id);
    sendData(response, { user });
  },
};
