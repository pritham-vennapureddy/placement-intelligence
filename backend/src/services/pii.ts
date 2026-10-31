import { hasPermission } from "@placement/shared";
import type { AuthenticatedUser } from "../middleware/authenticate.js";

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

export function maskMobile(mobile: string | null): string | null {
  return mobile ? `${mobile.slice(0, 2)}******${mobile.slice(-2)}` : null;
}

/** Hides contact details from users without candidate:pii:read. */
export function protectContact<T extends { email?: string | null; mobile?: string | null }>(user: AuthenticatedUser, candidate: T): T {
  if (hasPermission(user.roles, "candidate:pii:read")) return candidate;
  return {
    ...candidate,
    ...("email" in candidate ? { email: maskEmail(candidate.email ?? null) } : {}),
    ...("mobile" in candidate ? { mobile: maskMobile(candidate.mobile ?? null) } : {}),
  };
}
