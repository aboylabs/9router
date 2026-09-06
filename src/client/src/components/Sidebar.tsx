import { useEffect, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./ThemeToggle";

export type Page = "overview" | "keys" | "models" | "usage" | "requests" | "live" | "settings";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  adminEmail: string;
  onLogout: () => void;
}

const primary: { id: Page; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "keys", label: "Keys" },
  { id: "models", label: "Models" },
];

const monitor: { id: Page; label: string }[] = [
  { id: "usage", label: "Usage" },
  { id: "requests", label: "Requests" },
  { id: "live", label: "Live" },
];

export function Sidebar({ currentPage, onNavigate, adminEmail, onLogout }: SidebarProps) {
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const monitorActive = monitor.some((item) => item.id === currentPage);

  useEffect(() => {
    if (!monitorActive) setMonitorOpen(false);
  }, [monitorActive]);

  useEffect(() => {
    if (!monitorOpen) return;
    function onDoc(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (t && t.closest("[data-monitor-menu]")) return;
      setMonitorOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [monitorOpen]);

  function go(page: Page) {
    onNavigate(page);
    setMobileOpen(false);
    if (!monitor.some((item) => item.id === page)) setMonitorOpen(false);
  }

  const tabClass = (active: boolean) =>
    cn(
      "inline-flex items-center px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer",
      active
        ? "text-text-primary shadow-[inset_0_-2px_0_#7170ff] rounded-none"
        : "text-text-secondary hover:text-text-primary hover:bg-surface-tertiary"
    );

  return (
    <header className="sticky top-0 z-50 bg-surface-secondary/92 backdrop-blur border-b border-border">
      <div className="flex items-center gap-2 px-3 sm:px-5 h-14">
        <div className="flex items-center gap-2 shrink-0 mr-1">
          <img
            src="/admin/assets/brand/mark.webp"
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px] rounded-md object-contain"
          />
          <img
            src="/admin/assets/brand/wordmark.webp"
            alt="routers9"
            className="hidden sm:block h-3.5 w-auto"
          />
        </div>

        <nav className="hidden md:flex items-center gap-0.5 min-w-0">
          {primary.map((item) => (
            <button key={item.id} type="button" onClick={() => go(item.id)} className={tabClass(currentPage === item.id)}>
              {item.label}
            </button>
          ))}
          <div className="relative" data-monitor-menu>
            <button
              type="button"
              onClick={() => setMonitorOpen((v) => !v)}
              className={tabClass(monitorActive)}
            >
              Monitor <span className="ml-1 text-[10px] opacity-70">▾</span>
            </button>
            {monitorOpen && (
              <div className="absolute left-0 top-[calc(100%+6px)] min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-lg">
                {monitor.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    className={cn(
                      "block w-full text-left px-3 py-2 rounded-md text-[13px] cursor-pointer",
                      currentPage === item.id
                        ? "bg-surface-tertiary text-text-primary"
                        : "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => go("settings")} className={tabClass(currentPage === "settings")}>
            Settings
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="hidden lg:inline text-[12px] text-text-muted max-w-[180px] truncate">{adminEmail}</span>
          <ThemeToggle />
          <button
            type="button"
            onClick={onLogout}
            className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-tertiary cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-text-primary hover:bg-surface-tertiary cursor-pointer"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="md:hidden border-t border-border px-3 py-2 space-y-0.5">
          {[...primary, ...monitor, { id: "settings" as Page, label: "Settings" }].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              className={cn(
                "block w-full text-left px-3 py-2 rounded-md text-sm cursor-pointer",
                currentPage === item.id
                  ? "bg-surface-tertiary text-text-primary"
                  : "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
              )}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-surface-tertiary hover:text-text-primary cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </nav>
      )}
    </header>
  );
}
