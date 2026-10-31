// Role → permission map. Roles live in the database; what each role may do
// lives here so the API and the UI agree. Data scope (organisation / team /
// own job requests) is applied separately on the server.

export const ROLES = ["ADMIN", "MANAGER", "PSM", "VIEWER"] as const;
export type RoleCode = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard:read",
  "user:manage",
  "team:manage",
  "team:read",
  "sheet:read",
  "sheet:manage",
  "company:read",
  "company:write",
  "job:read",
  "job:write",
  "job:assign",
  "candidate:read",
  "candidate:write",
  "candidate:pii:read",
  "screening:write",
  "pipeline:write",
  "import:run",
  "report:read",
  "report:export",
  "audit:read",
  "integration:admin",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const allPermissions: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  ADMIN: allPermissions,
  MANAGER: [
    "dashboard:read",
    "team:read",
    "sheet:read",
    "sheet:manage",
    "company:read",
    "company:write",
    "job:read",
    "job:write",
    "job:assign",
    "candidate:read",
    "candidate:write",
    "candidate:pii:read",
    "screening:write",
    "pipeline:write",
    "import:run",
    "report:read",
    "report:export",
    "audit:read",
  ],
  PSM: [
    "dashboard:read",
    "sheet:read",
    "company:read",
    "company:write",
    "job:read",
    "job:write",
    "candidate:read",
    "candidate:write",
    "candidate:pii:read",
    "screening:write",
    "pipeline:write",
    "import:run",
    "report:read",
    "report:export",
  ],
  VIEWER: ["dashboard:read", "sheet:read", "company:read", "job:read", "candidate:read", "report:read"],
};

function isRoleCode(value: string): value is RoleCode {
  return (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    if (isRoleCode(role)) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        granted.add(permission);
      }
    }
  }
  return granted;
}

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}
