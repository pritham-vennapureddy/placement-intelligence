import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validateBody } from "../../middleware/validate-body.js";
import { getCurrentUser, login, logout, refresh } from "../../services/auth.service.js";
import { ApiError } from "../../utils/api-error.js";
import { loginSchema } from "../../validators/auth.validators.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." },
  },
});

const refreshCookie = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

authRouter.post("/login", loginLimiter, validateBody(loginSchema), async (request, response) => {
  const result = await login(request.body.email, request.body.password);
  response.cookie("refreshToken", result.refreshToken, refreshCookie);
  response.json({ data: { accessToken: result.accessToken, user: result.user } });
});

authRouter.post("/refresh", async (request, response) => {
  const result = await refresh(request.cookies.refreshToken);
  response.cookie("refreshToken", result.refreshToken, refreshCookie);
  response.json({ data: { accessToken: result.accessToken, user: result.user } });
});

authRouter.post("/logout", async (request, response) => {
  await logout(request.cookies.refreshToken);
  response.clearCookie("refreshToken", {
    httpOnly: refreshCookie.httpOnly,
    secure: refreshCookie.secure,
    sameSite: refreshCookie.sameSite,
    path: refreshCookie.path,
  });
  response.status(204).end();
});

authRouter.get("/me", authenticate, async (request, response) => {
  if (!request.user) {
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  const user = await getCurrentUser(request.user.id);
  response.json({ data: { user } });
});
