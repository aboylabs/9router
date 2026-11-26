import { useEffect, useState } from "react";
import { Globe, ShieldCheck, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/Dialog";
import { Button } from "./ui/Button";
import type { Model, ModelAccessRole } from "../hooks/useDashboard";

interface ModelAccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: Model | null;
  saving: boolean;
  onSave: (model: Model, roles: ModelAccessRole[]) => Promise<void> | void;
}

const ALL_ROLES: ModelAccessRole[] = ["dev", "supporter", "ultra", "pro"];

const ROLE_INFO: Record<ModelAccessRole, { label: string; desc: string; accent: string }> = {
  dev: {
    label: "KING (Super Admin)",
    desc: "Key milik buyer Super Admin",
    accent: "text-red-500",
  },
  supporter: {
    label: "Supporter",
    desc: "Roster donatur (name-match)",
    accent: "text-amber-500",
  },
  ultra: {
    label: "Ultra (500M)",
    desc: "Key paket Ultra — quota 500M",
    accent: "text-cyan-500",
  },
  pro: {
    label: "Pro",
    desc: "Key dengan role Pro (assign via API Keys)",
    accent: "text-blue-500",
  },
};

function normalizeRoles(model: Model | null): ModelAccessRole[] {
  if (!model) return [];
  const raw = Array.isArray(model.access_roles) ? model.access_roles.map(String).map((x) => x.toLowerCase()) : [];
  const normalized = ALL_ROLES.filter((r) => raw.includes(r));
  if (!normalized.length && model.privileged_only) return ["dev", "supporter"];
  return normalized;
}

export function ModelAccessModal({ open, onOpenChange, model, saving, onSave }: ModelAccessModalProps) {
  const [selected, setSelected] = useState<ModelAccessRole[]>([]);

  useEffect(() => {
    if (open) setSelected(normalizeRoles(model));
  }, [open, model]);

  const allKeys = selected.length === 0;

  function chooseAllKeys() {
    setSelected([]);
  }

  function toggle(role: ModelAccessRole) {
    setSelected((prev) => {
      const next = prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role];
      return ALL_ROLES.filter((r) => next.includes(r));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!model) return;
    await onSave(model, selected);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Model Access</DialogTitle>
          <DialogDescription>
            Pilih siapa yang boleh mengakses{" "}
            <code className="text-xs bg-surface-tertiary px-1 py-0.5 rounded font-mono break-all">
              {model?.id || ""}
            </code>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            {/* Semua key (default terbuka) */}
            <label
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                allKeys ? "border-accent bg-accent/5" : "border-border hover:border-border-primary"
              }`}
            >
              <input
                type="radio"
                name="access-mode"
                checked={allKeys}
                onChange={chooseAllKeys}
                className="mt-0.5 h-4 w-4 accent-current"
              />
              <span className="flex-1">
                <span className={`flex items-center gap-1.5 text-sm font-medium ${allKeys ? "text-emerald-500" : "text-text-primary"}`}>
                  <Globe className="h-3.5 w-3.5" />
                  Semua Key (Public)
                </span>
                <span className="block text-xs text-text-muted mt-0.5">
                  Semua key aktif bisa akses — tanpa batasan role
                </span>
              </span>
            </label>

            <div className="flex items-center gap-2 px-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wide text-text-muted">atau batasi ke role</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {ALL_ROLES.map((role) => {
              const info = ROLE_INFO[role];
              const on = selected.includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    on ? "border-accent bg-accent/5" : "border-border hover:border-border-primary"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(role)}
                    className="mt-0.5 h-4 w-4 accent-current"
                  />
                  <span className="flex-1">
                    <span className={`flex items-center gap-1.5 text-sm font-medium ${on ? info.accent : "text-text-primary"}`}>
                      {role === "ultra" ? <Zap className="h-3.5 w-3.5" /> : null}
                      {info.label}
                    </span>
                    <span className="block text-xs text-text-muted mt-0.5">{info.desc}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <p className="text-xs text-text-muted">
            {allKeys
              ? "Model terbuka: semua key aktif di-grant akses."
              : "Model dibatasi: hanya role tercentang yang di-grant; akses key lain dicabut otomatis."}
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <ShieldCheck className="h-4 w-4" />
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
