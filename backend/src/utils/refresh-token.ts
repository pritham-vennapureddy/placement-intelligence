import { createHmac, randomBytes } from "node:crypto";

export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}
