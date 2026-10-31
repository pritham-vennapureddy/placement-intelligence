import { hash } from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { authorize } from "../../middleware/authorize.js";
import { validateBody } from "../../middleware/validate-body.js";
import { prisma } from "../../db.js";
import { ApiError } from "../../utils/api-error.js";

export const teamsRouter = Router();

const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

const createUserSchema = z.object({
  email: z.email().max(254),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128),
  role: z.enum(["MANAGER", "PSM"]),
  teamId: z.uuid().optional(),
});

const teamMembersSchema = z.object({
  teamLeadId: z.uuid().nullable(),
  psmIds: z.array(z.uuid()).max(200),
});

const teamInclude = {
  teamLead: { select: { id: true, fullName: true, email: true, isActive: true } },
  members: {
    where: { isActive: true },
    select: {
      id: true,
      fullName: true,
      email: true,
      roles: { select: { role: { select: { code: true } } } },
    },
    orderBy: { fullName: "asc" as const },
  },
  _count: { select: { members: true, sheetConnections: true } },
} as const;

teamsRouter.use(authenticate);

teamsRouter.get("/", async (request, response) => {
  if (request.user?.roles.includes("ADMIN")) {
    const teams = await prisma.team.findMany({
      include: teamInclude,
      orderBy: { name: "asc" },
    });
    response.json({ data: { teams } });
    return;
  }

  if (!request.user?.roles.includes("MANAGER")) {
    throw new ApiError(403, "FORBIDDEN", "Only administrators and team leads can view team management.");
  }

  const team = await prisma.team.findFirst({
    where: { teamLeadId: request.user.id },
    include: teamInclude,
  });
  response.json({ data: { teams: team ? [team] : [] } });
});

teamsRouter.get("/users", authorize("ADMIN"), async (_request, response) => {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { code: { in: ["MANAGER", "PSM"] } } } },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      teamId: true,
      roles: { select: { role: { select: { code: true } } } },
    },
    orderBy: { fullName: "asc" },
  });
  response.json({ data: { users } });
});

teamsRouter.post(
  "/",
  authorize("ADMIN"),
  validateBody(createTeamSchema),
  async (request, response) => {
    const team = await prisma.team.create({
      data: { name: request.body.name, createdById: request.user!.id },
      include: teamInclude,
    });
    response.status(201).json({ data: { team } });
  },
);

teamsRouter.post(
  "/users",
  authorize("ADMIN"),
  validateBody(createUserSchema),
  async (request, response) => {
    const input = request.body as z.infer<typeof createUserSchema>;
    if (input.role === "PSM" && !input.teamId) {
      throw new ApiError(400, "PSM_TEAM_REQUIRED", "Assign each PSM to a team when creating the account.");
    }
    if (input.teamId) {
      const team = await prisma.team.findUnique({ where: { id: input.teamId } });
      if (!team) {
        throw new ApiError(404, "TEAM_NOT_FOUND", "The selected team was not found.");
      }
      if (input.role === "MANAGER" && team.teamLeadId) {
        throw new ApiError(409, "TEAM_LEAD_EXISTS", "This team already has a team lead.");
      }
    }

    const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (existing) {
      throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists.");
    }

    const passwordHash = await hash(input.password, 12);
    const user = await prisma.$transaction(async (transaction) => {
      const role = await transaction.role.upsert({
        where: { code: input.role },
        create: {
          code: input.role,
          name: input.role === "MANAGER" ? "Team Lead" : "Placement Success Manager",
        },
        update: {},
      });
      const created = await transaction.user.create({
        data: {
          email: input.email.toLowerCase(),
          fullName: input.fullName,
          passwordHash,
          ...(input.teamId ? { teamId: input.teamId } : {}),
          roles: { create: { roleId: role.id } },
        },
        select: { id: true, fullName: true, email: true, isActive: true, teamId: true },
      });

      if (input.role === "MANAGER" && input.teamId) {
        await transaction.team.update({
          where: { id: input.teamId },
          data: { teamLeadId: created.id },
        });
      }
      return created;
    });

    response.status(201).json({ data: { user } });
  },
);

teamsRouter.put(
  "/:teamId/members",
  authorize("ADMIN"),
  validateBody(teamMembersSchema),
  async (request, response) => {
    const teamId = z.uuid().parse(request.params.teamId);
    const { teamLeadId, psmIds } = request.body as z.infer<typeof teamMembersSchema>;
    const uniquePsmIds = [...new Set(psmIds)];
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new ApiError(404, "TEAM_NOT_FOUND", "The selected team was not found.");
    }

    const selectedIds = [...uniquePsmIds, ...(teamLeadId ? [teamLeadId] : [])];
    const selectedUsers = await prisma.user.findMany({
      where: { id: { in: selectedIds }, isActive: true },
      include: { roles: { include: { role: true } } },
    });
    if (selectedUsers.length !== new Set(selectedIds).size) {
      throw new ApiError(400, "INVALID_TEAM_MEMBER", "One or more selected users are unavailable.");
    }

    const lead = teamLeadId ? selectedUsers.find(({ id }) => id === teamLeadId) : undefined;
    if (teamLeadId && !lead?.roles.some(({ role }) => role.code === "MANAGER")) {
      throw new ApiError(400, "INVALID_TEAM_LEAD", "The team lead must have a Manager account.");
    }
    if (uniquePsmIds.some((id) => !selectedUsers.find(({ id: userId, roles }) =>
      userId === id && roles.some(({ role }) => role.code === "PSM"),
    ))) {
      throw new ApiError(400, "INVALID_PSM", "Team members must have PSM accounts.");
    }

    await prisma.$transaction(async (transaction) => {
      if (teamLeadId) {
        await transaction.team.updateMany({
          where: { teamLeadId, id: { not: team.id } },
          data: { teamLeadId: null },
        });
      }

      const previousLeadId = team.teamLeadId;
      if (previousLeadId && previousLeadId !== teamLeadId) {
        await transaction.user.updateMany({
          where: { id: previousLeadId, teamId: team.id },
          data: { teamId: null },
        });
      }
      if (teamLeadId) {
        await transaction.user.update({ where: { id: teamLeadId }, data: { teamId: team.id } });
      }

      const currentPsms = await transaction.user.findMany({
        where: { teamId: team.id, roles: { some: { role: { code: "PSM" } } } },
        select: { id: true },
      });
      const removedIds = currentPsms.map(({ id }) => id).filter((id) => !uniquePsmIds.includes(id));
      if (removedIds.length > 0) {
        await transaction.user.updateMany({
          where: { id: { in: removedIds }, teamId: team.id },
          data: { teamId: null },
        });
      }
      if (uniquePsmIds.length > 0) {
        await transaction.user.updateMany({
          where: { id: { in: uniquePsmIds }, isActive: true },
          data: { teamId: team.id },
        });
      }
      await transaction.team.update({
        where: { id: team.id },
        data: { teamLeadId },
      });
    });

    const updatedTeam = await prisma.team.findUniqueOrThrow({
      where: { id: team.id },
      include: teamInclude,
    });
    response.json({ data: { team: updatedTeam } });
  },
);
