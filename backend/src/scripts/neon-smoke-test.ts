import { env } from "../config/env.js";
import {
  testFunction,
  testObjectStorage,
  testPostgres,
  testRealtime,
} from "../modules/neon/neon.services.js";

const checks: [string, () => Promise<void>][] = [
  ["Postgres", testPostgres],
  ["Object Storage", testObjectStorage],
  ["Functions", testFunction],
  ["Realtime", testRealtime],
];

function safeErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : "Unknown error.";
  for (const secret of [
    env.DATABASE_URL,
    env.DATABASE_URL_UNPOOLED,
    env.DIRECT_URL,
    env.NEON_REALTIME_SECRET,
    env.AWS_ACCESS_KEY_ID,
    env.AWS_SECRET_ACCESS_KEY,
  ]) {
    if (secret) {
      message = message.replaceAll(secret, "[redacted]");
    }
  }
  return message;
}

let failed = false;
for (const [service, check] of checks) {
  try {
    await check();
    console.log(`${service}: PASS`);
  } catch (error) {
    failed = true;
    console.error(`${service}: FAIL — ${safeErrorMessage(error)}`);
  }
}

if (failed) {
  process.exitCode = 1;
}
