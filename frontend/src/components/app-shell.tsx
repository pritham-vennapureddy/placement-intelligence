import { useState } from "react";
import { GraduationCap, LogOut, Menu, X } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "./ui/button";
import { useAuth } from "../contexts/auth-context";
import { usePermissions } from "../hooks/use-permissions";
import { findNavItem, NAVIGATION } from "../routes/navigation";
import { cn } from "../utils/cn";

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { canSee } = usePermissions();
  const location = useLocation();
  const currentPage = findNavItem(location.pathname);
  const navigation = NAVIGATION
    .map((group) => ({ ...group, items: group.items.filter(canSee) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      {menuOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-[76px] items-center justify-between border-b border-slate-100 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <GraduationCap size={22} strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-900">PlacementOS</p>
              <p className="text-[11px] font-medium text-slate-400">INTELLIGENCE PLATFORM</p>
            </div>
          </div>
          <Button
            aria-label="Close navigation"
            className="lg:hidden"
            size="icon"
            variant="ghost"
            onClick={() => setMenuOpen(false)}
          >
            <X size={18} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-5">
          {navigation.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{group.label}</p>
              <nav className="space-y-0.5" aria-label={group.label}>
                {group.items.map(({ label, icon: Icon, path }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === "/"}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition",
                        isActive
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                      )
                    }
                  >
                    <Icon size={17} />
                    {label}
                  </NavLink>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
              {user?.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{user?.fullName}</p>
              <p className="truncate text-xs text-slate-500">{user?.roles.join(", ")}</p>
            </div>
            <Button
              aria-label="Sign out"
              size="icon"
              variant="ghost"
              title="Sign out"
              onClick={() => void signOut()}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <Button
              aria-label="Open navigation"
              className="lg:hidden"
              size="icon"
              variant="ghost"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={19} />
            </Button>
            <div>
              <p className="text-xs font-medium text-slate-400">Placement operations</p>
              <p className="text-sm font-semibold text-slate-800">{currentPage?.label ?? "Overview"}</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Workspace ready
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
