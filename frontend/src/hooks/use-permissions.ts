import { useCallback } from "react";
import { hasPermission, type Permission } from "@placement/shared";
import { useAuth } from "../contexts/auth-context";
import type { NavItem } from "../routes/navigation";

/**
 * Permission checks for showing or hiding UI. The API enforces the same map,
 * so hiding something here is a convenience, not the security boundary.
 */
export function usePermissions() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];

  const can = useCallback((permission: Permission) => hasPermission(roles, permission), [roles]);
  const canSee = useCallback(
    (item: Pick<NavItem, "permission" | "roles">) =>
      can(item.permission) && (!item.roles || item.roles.some((role) => roles.includes(role))),
    [can, roles],
  );

  return { can, canSee };
}
