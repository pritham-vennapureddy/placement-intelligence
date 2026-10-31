import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client.js";
import { env } from "./config/env.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

/** Either the root client or an interactive-transaction client. Repositories accept this. */
export type Db = typeof prisma | Prisma.TransactionClient;

/** Runs `work` in one interactive transaction; services use this for multi-step writes. */
export function inTransaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(work);
}
