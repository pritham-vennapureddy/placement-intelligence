import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../backend/src/generated/prisma/client.js";
import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL;
const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
const adminName = process.env.ADMIN_NAME ?? "Platform Administrator";

if (!databaseUrl || !adminEmail || !adminPassword) {
  throw new Error("DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD must be set to seed the database.");
}

if (adminPassword.length < 12) {
  throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function main(): Promise<void> {
  const roles = [
    { code: "ADMIN", name: "Administrator" },
    { code: "MANAGER", name: "Manager" },
    { code: "PSM", name: "Placement Success Manager" },
    { code: "VIEWER", name: "Read-only Viewer" },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      create: role,
      update: { name: role.name },
    });
  }

  const passwordHash = await hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      fullName: adminName,
      passwordHash,
    },
    update: {},
  });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    create: { userId: admin.id, roleId: adminRole.id },
    update: {},
  });
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed the database.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
  await prisma.$disconnect();
  });
