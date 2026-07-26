import { useState } from "react";
import {
  LayoutDashboard,
  Key,
  Box,
  Activity,
  Radio,
  LogOut,
  Menu,
  X,
  Settings,
  Trophy
} from "lucide-react";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./ThemeToggle";

export type Page = "overview" | "keys" | "models" | "usage" | "live" | "leaderboard" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  adminEmail: string;
  onLogout: () => void;
}

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "keys", label: "API Keys", icon: Key },
  { id: "models", label: "Models", icon: Box },
  { id: "usage", label: "Usage", icon: Activity },
  { id: "live", label: "Live", icon: Radio },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ currentPage, onNavigate, adminEmail, onLogout }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 lg:hidden flex items-center justify-center h-10 w-10 rounded-xl bg-surface/90 backdrop-blur border border-border shadow-sm text-text-primary cursor-pointer"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar flex flex-col transition-transform duration-200 border-r border-white/5",
          "lg:translate-x-0 lg:static lg:z-auto",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-900/30 shrink-0">
              <span className="text-white text-[11px] font-extrabold tracking-tight">R9</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-white tracking-tight leading-tight">Routers9</h1>
              <p className="text-[10px] text-sidebar-muted uppercase tracking-wider">Admin</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden flex items-center justify-center h-8 w-8 rounded-md text-sidebar-muted hover:text-sidebar-text cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer",
                  active
                    ? "bg-primary-600 text-white shadow-md shadow-primary-900/30"
                    : "text-sidebar-muted hover:text-sidebar-text hover:bg-sidebar-hover"
                )}
              >
                <Icon className={cn("h-4 w-4", active ? "text-white" : "text-sidebar-muted")} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/10 space-y-3">
          <div className="rounded-lg bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-sidebar-muted mb-0.5">Signed in</p>
            <p className="text-xs text-sidebar-text truncate font-medium">{adminEmail}</p>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-sidebar-muted hover:text-white hover:bg-red-500/15 transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
