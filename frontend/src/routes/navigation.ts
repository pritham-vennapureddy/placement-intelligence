import type { Permission } from "@placement/shared";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  Network,
  UploadCloud,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  permission: Permission;
  /** Only shown to users holding one of these roles. */
  roles?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", icon: LayoutDashboard, path: "/", permission: "dashboard:read" },
      { label: "My workspace", icon: Activity, path: "/psm-workspace", permission: "dashboard:read", roles: ["PSM", "MANAGER"] },
    ],
  },
  {
    label: "Placements",
    items: [
      { label: "Companies", icon: Building2, path: "/companies", permission: "company:read" },
      { label: "Job requests", icon: BriefcaseBusiness, path: "/job-requests", permission: "job:read" },
      { label: "Candidates", icon: Users, path: "/candidates", permission: "candidate:read" },
      { label: "Assessed pool", icon: UserRoundCheck, path: "/assessed-pool", permission: "candidate:read" },
      { label: "Internal screening", icon: ClipboardCheck, path: "/screening", permission: "job:read" },
      { label: "Company pipeline", icon: GitBranch, path: "/pipeline", permission: "job:read" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "PSM operations", icon: ClipboardList, path: "/psm-operations", permission: "job:write" },
      { label: "RSA & homework", icon: GraduationCap, path: "/rsa", permission: "candidate:write" },
    ],
  },
  {
    label: "Data & reports",
    items: [
      { label: "Import centre", icon: UploadCloud, path: "/imports", permission: "import:run" },
      { label: "Sheet connections", icon: FileSpreadsheet, path: "/sheets", permission: "sheet:read" },
      { label: "Reports", icon: BarChart3, path: "/reports", permission: "report:read" },
    ],
  },
  {
    label: "Administration",
    items: [{ label: "Teams", icon: Network, path: "/teams", permission: "team:read" }],
  },
];

export const NAV_ITEMS = NAVIGATION.flatMap((group) => group.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === pathname)
    ?? NAV_ITEMS.find((item) => item.path !== "/" && pathname.startsWith(`${item.path}/`));
}
