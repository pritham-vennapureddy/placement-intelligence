import { prisma } from "../../db.js";

export const catalogRepository = {
  listActiveProducts() {
    return prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, category: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  },

  listSkills() {
    return prisma.skill.findMany({
      select: { id: true, name: true, normalizedName: true },
      orderBy: { name: "asc" },
    });
  },

  /** Active PSMs, limited to `ids` when given. */
  listActivePsms(ids?: string[]) {
    return prisma.user.findMany({
      where: {
        isActive: true,
        roles: { some: { role: { code: "PSM" } } },
        ...(ids ? { id: { in: ids } } : {}),
      },
      select: { id: true, fullName: true, team: { select: { name: true } } },
      orderBy: { fullName: "asc" },
    });
  },
};
