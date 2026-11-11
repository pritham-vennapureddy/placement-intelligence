-- Rename the two legacy roles while keeping every existing user assignment.
INSERT INTO "Role" ("id", "code", "name")
VALUES (gen_random_uuid(), 'EMPLOYEE', 'Employee')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Role" ("id", "code", "name")
VALUES (gen_random_uuid(), 'STAKEHOLDER', 'Stakeholder')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "UserRole" ("userId", "roleId")
SELECT assignments."userId", replacement."id"
FROM "UserRole" assignments
JOIN "Role" legacy ON legacy."id" = assignments."roleId" AND legacy."code" = 'PSM'
JOIN "Role" replacement ON replacement."code" = 'EMPLOYEE'
ON CONFLICT ("userId", "roleId") DO NOTHING;

INSERT INTO "UserRole" ("userId", "roleId")
SELECT assignments."userId", replacement."id"
FROM "UserRole" assignments
JOIN "Role" legacy ON legacy."id" = assignments."roleId" AND legacy."code" = 'VIEWER'
JOIN "Role" replacement ON replacement."code" = 'STAKEHOLDER'
ON CONFLICT ("userId", "roleId") DO NOTHING;

DELETE FROM "UserRole"
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "code" IN ('PSM', 'VIEWER'));

DELETE FROM "Role" WHERE "code" IN ('PSM', 'VIEWER');

UPDATE "Role" SET "name" = 'Manager' WHERE "code" = 'MANAGER';

-- Keep the oldest existing team as the single shared workspace and migrate
-- every account and spreadsheet connection to it before removing other teams.
DO $$
DECLARE
  workspace_id UUID;
BEGIN
  SELECT "id"
  INTO workspace_id
  FROM "Team"
  ORDER BY "createdAt" ASC, "id" ASC
  LIMIT 1;

  IF workspace_id IS NOT NULL THEN
    UPDATE "User" SET "teamId" = workspace_id;
    UPDATE "SheetConnection" SET "teamId" = workspace_id;
    DELETE FROM "Team" WHERE "id" <> workspace_id;
  END IF;
END $$;
