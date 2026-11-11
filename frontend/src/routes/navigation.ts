import type { Permission } from "@placement/shared";
import {
  Activity,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileSpreadsheet,
  GitBranch,
  LayoutDashboard,
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
      { label: "My companies", icon: Activity, path: "/my-work", permission: "dashboard:read" },
      { label: "Insights", icon: ChartNoAxesCombined, path: "/insights", permission: "report:read" },
    ],
  },
  {
    label: "Placements",
    items: [
      { label: "Job requests", icon: BriefcaseBusiness, path: "/job-requests", permission: "job:read" },
      { label: "Candidates", icon: Users, path: "/candidates", permission: "candidate:read" },
      { label: "Assessed pool", icon: UserRoundCheck, path: "/assessed-pool", permission: "candidate:read" },
      { label: "Internal screening", icon: ClipboardCheck, path: "/screening", permission: "job:read" },
      { label: "Company pipeline", icon: GitBranch, path: "/pipeline", permission: "job:read" },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Import Google Sheets", icon: UploadCloud, path: "/imports", permission: "import:run" },
      { label: "Sheet connections", icon: FileSpreadsheet, path: "/sheets", permission: "sheet:read" },
    ],
  },
  {
    label: "Administration",
    items: [{ label: "User access", icon: Users, path: "/users", permission: "user:manage" }],
  },
];

export const NAV_ITEMS = NAVIGATION.flatMap((group) => group.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === pathname)
    ?? NAV_ITEMS.find((item) => item.path !== "/" && pathname.startsWith(`${item.path}/`));
}
