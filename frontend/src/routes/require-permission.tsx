import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePermissions } from "../hooks/use-permissions";
import type { NavItem } from "./navigation";

export function RequirePermission({ item, children }: { item: Pick<NavItem, "permission" | "roles">; children: ReactNode }) {
  const { canSee } = usePermissions();
  return canSee(item) ? children : <Navigate to="/" replace />;
}
