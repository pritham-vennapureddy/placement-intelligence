import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../db.js";

const ASSETS_BUCKET = "assets";
const textEncoder = new TextEncoder();
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (
    !env.AWS_ACCESS_KEY_ID ||
    !env.AWS_SECRET_ACCESS_KEY ||
    !env.AWS_ENDPOINT_URL_S3 ||
    !env.AWS_REGION
  ) {
    throw new Error("Neon Object Storage is not configured.");
  }

  s3Client ??= new S3Client({
    endpoint: env.AWS_ENDPOINT_URL_S3,
    region: env.AWS_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

export async function testPostgres(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1::int AS ok`;
  if (rows[0]?.ok !== 1) {
    throw new Error("Neon Postgres returned an unexpected connectivity result.");
  }
}

export async function testObjectStorage(): Promise<void> {
  const client = getS3Client();
  const key = `health-check/${randomUUID()}.txt`;
  const body = `placement-dashboard-${randomUUID()}`;
  let uploaded = false;

  try {
    await client.send(new PutObjectCommand({
      Bucket: ASSETS_BUCKET,
      Key: key,
      Body: body,
      ContentType: "text/plain",
    }));
    uploaded = true;

    const object = await client.send(new GetObjectCommand({ Bucket: ASSETS_BUCKET, Key: key }));
    const downloaded = await object.Body?.transformToString();
    if (downloaded !== body) {
      throw new Error("Neon Object Storage returned unexpected object contents.");
    }
  } finally {
    if (uploaded) {
      await client.send(new DeleteObjectCommand({ Bucket: ASSETS_BUCKET, Key: key }));
    }
  }
}

export async function testFunction(): Promise<void> {
  if (!env.NEON_FUNCTION_HELLO_BASE_URL) {
    throw new Error("Neon Function URL is not configured.");
  }

  const response = await fetch(env.NEON_FUNCTION_HELLO_BASE_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Neon Function returned HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("service" in body) ||
    body.service !== "placement-dashboard" ||
    !("status" in body) ||
    body.status !== "ok"
  ) {
    throw new Error("Neon Function returned an unexpected health response.");
  }
}

export async function testRealtime(): Promise<void> {
  if (!env.NEON_REALTIME_URL || !env.NEON_REALTIME_SECRET) {
    throw new Error("Neon Realtime is not configured.");
  }

  const database = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\/+/, ""));
  const realtime = createRealtime({
    url: env.NEON_REALTIME_URL,
    secret: env.NEON_REALTIME_SECRET,
    db: database,
  });
  const subscription = await realtime.subscribe(
    rawSql<{ total: number }>('SELECT count(*)::int AS total FROM "Company"'),
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stopListening();
        reject(new Error("Neon Realtime did not return an initial query result in time."));
      }, 15_000);
      let stopListening: () => void = () => {};

      stopListening = subscription.onChange((snapshot) => {
        if (snapshot.status === "error") {
          clearTimeout(timeout);
          stopListening();
          reject(new Error(`Neon Realtime subscription failed: ${snapshot.error.message}`));
        } else if (snapshot.status === "live" && typeof snapshot.data?.[0]?.total === "number") {
          clearTimeout(timeout);
          stopListening();
          resolve();
        }
      });
    });
  } finally {
    subscription.unsubscribe();
    realtime.close();
  }
}
