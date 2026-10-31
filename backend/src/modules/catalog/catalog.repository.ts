import { prisma } from "../../db.js";

export const catalogRepository = {
  listActiveProducts() {
    return prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  },

  listSkills() {
    return prisma.skill.findMany({
      select: { id: true, name: true, normalizedName: true },
      orderBy: { name: "asc" },
    });
  },
};
