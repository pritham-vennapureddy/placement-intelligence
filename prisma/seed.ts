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
    { code: "EMPLOYEE", name: "Employee" },
    { code: "STAKEHOLDER", name: "Stakeholder" },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      create: role,
      update: { name: role.name },
    });
  }

  // Candidate products as they appear in platform exports. Category mapping is
  // an assumption to confirm: Academy plans, Intensive plans, External.
  const products = [
    { code: "CCBP_ACADEMY_SMART", name: "CCBP Academy Smart", category: "ACADEMY" },
    { code: "CCBP_ACADEMY_GENIUS", name: "CCBP Academy Genius", category: "ACADEMY" },
    { code: "CCBP_ACADEMY_EDGE", name: "CCBP Academy Edge", category: "ACADEMY" },
    { code: "CCBP_ACADEMY_SMART_CAREER_PLUS", name: "CCBP Academy Smart Career Plus", category: "ACADEMY" },
    { code: "CCBP_ACADEMY_GENIUS_CAREER_PLUS", name: "CCBP Academy Genius Career Plus", category: "ACADEMY" },
    { code: "CCBP_INTENSIVE", name: "CCBP Intensive", category: "ACADEMY_INTENSIVE" },
    { code: "CCBP_INTENSIVE_NSDC_SKILL_INDIA", name: "CCBP Intensive NSDC Skill India", category: "ACADEMY_INTENSIVE" },
    { code: "INTENSIVE_COLLEGE_PLUS", name: "Intensive College Plus", category: "ACADEMY_INTENSIVE" },
    { code: "External", name: "External", category: "EXTERNAL" },
  ] as const;

  for (const product of products) {
    await prisma.product.upsert({
      where: { code: product.code },
      create: product,
      update: { name: product.name, category: product.category },
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

  let workspace = await prisma.team.findFirst({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!workspace) {
    workspace = await prisma.team.create({
      data: { name: "Placement Team", createdById: admin.id },
      select: { id: true },
    });
  }
  await prisma.user.update({ where: { id: admin.id }, data: { teamId: workspace.id } });
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed the database.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
  await prisma.$disconnect();
  });
