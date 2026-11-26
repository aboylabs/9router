import { useState, useEffect, useMemo } from "react";
import { KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api } from "../lib/api";
import { SuccessModal } from "./SuccessModal";
import {
  CREATE_KEY_PACKAGES,
  DEFAULT_CREATE_KEY_PACKAGE_ID,
  type CreateKeyPackageId,
} from "@shared/package-catalog";

interface CreateKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface CreateKeyResult {
  apiKey: string;
  name: string;
  email: string;
  password: string;
  isExistingBuyer: boolean;
  created_at?: string;
  days: number;
  package: {
    id: string | null;
    label: string;
    quota_tokens: number | null;
    daily_quota_tokens: number | null;
    daily_reset: boolean;
    rate_limit_rpm?: number | null;
    expires_at: string | null;
  };
}

function formatQuotaM(tokens: number): string {
  return `${Math.round(tokens / 1_000_000)}M`;
}

function formatPriceId(rp: number): string {
  return `Rp ${rp.toLocaleString("id-ID")}`;
}

export function CreateKeyModal({ open, onOpenChange, onSuccess }: CreateKeyModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateKeyResult | null>(null);
  const [userName, setUserName] = useState("");
  const [rpm, setRpm] = useState("20");
  const [days, setDays] = useState("28");
  const [noExpiry, setNoExpiry] = useState(false);
  const [unlimitedQuota, setUnlimitedQuota] = useState(true);
  const [quotaTokensM, setQuotaTokensM] = useState("100");
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setResult(null);
      setUserName("");
      setRpm("20");
      setNoExpiry(false);
      setUnlimitedQuota(true);
      setQuotaTokensM("100");
      setSelectedRoles(new Set());
      setDays("28");
    }
  }, [open]);

  const daysNum = parseInt(days, 10);
  const daysValid = noExpiry || (!isNaN(daysNum) && daysNum > 0);

  const rpmNum = parseInt(rpm, 10);
  const rpmValid = !isNaN(rpmNum) && rpmNum >= 1 && rpmNum <= 500;

  const AVAILABLE_ROLES: { id: string; label: string; color: string }[] = [
    { id: "dev", label: "KING", color: "red" },
    { id: "supporter", label: "Supporter", color: "amber" },
    { id: "ultra", label: "Ultra", color: "cyan" },
    { id: "pro", label: "Pro", color: "blue" },
  ];

  const toggleRole = (role: string) => {
    const next = new Set(selectedRoles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setSelectedRoles(next);
  };

  const roleColorClasses: Record<string, string> = {
    red: "border-red-400/50 bg-red-500/15 text-red-700 dark:text-red-300",
    amber: "border-amber-400/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    cyan: "border-cyan-400/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    blue: "border-blue-400/50 bg-blue-500/15 text-blue-700 dark:text-blue-300",
  };
  const roleColorClassesOff: Record<string, string> = {
    red: "border-border bg-surface text-text-muted hover:border-red-400/40",
    amber: "border-border bg-surface text-text-muted hover:border-amber-400/40",
    cyan: "border-border bg-surface text-text-muted hover:border-cyan-400/40",
    blue: "border-border bg-surface text-text-muted hover:border-blue-400/40",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userName.trim()) {
      toast("Nama User wajib diisi", "error");
      return;
    }
    if (!daysValid) {
      toast("Jumlah hari harus diisi dengan angka positif", "error");
      return;
    }
    if (!rpmValid) {
      toast("RPM harus antara 1 sampai 500", "error");
      return;
    }
    setLoading(true);
    try {
      const qTokens = unlimitedQuota ? null : (parseInt(quotaTokensM, 10) * 1_000_000 || null);
      const data = await api<CreateKeyResult>("/admin/create-key", {
        method: "POST",
        body: JSON.stringify({
          name: userName.trim(),
          days: noExpiry ? undefined : daysNum,
          noExpiry,
          rateLimitRpm: rpmNum,
          unlimitedQuota,
          quotaTokens: qTokens,
          roles: Array.from(selectedRoles),
        })
      });
      setResult(data);
      onSuccess();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create key", "error");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <SuccessModal
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            setResult(null);
            onOpenChange(false);
          }
        }}
        data={result}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Buat API key baru dengan konfigurasi role, limit RPM, dan masa aktif.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Nama User</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Masukkan nama user..."
              className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Roles</label>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_ROLES.map((r) => {
                const active = selectedRoles.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRole(r.id)}
                    className={`h-7 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                      active ? roleColorClasses[r.color] : roleColorClassesOff[r.color]
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-text-muted mt-1">
              Role memberikan akses ke model khusus (Ultra / Pro / Supporter)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Rate Limit (RPM)</label>
            <input
              type="number"
              min="1"
              max="500"
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
              placeholder="20"
              className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-text-muted mt-1">
              Maksimum request per menit (default 20 RPM)
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={unlimitedQuota}
                onChange={(e) => setUnlimitedQuota(e.target.checked)}
                className="h-4 w-4 rounded border-border-primary text-primary-500 focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-text-secondary">Unlimited quota (∞)</span>
            </label>
            {!unlimitedQuota && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={quotaTokensM}
                  onChange={(e) => setQuotaTokensM(e.target.value)}
                  placeholder="100"
                  className="w-28 px-3 py-1.5 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <span className="text-sm text-text-secondary">Juta tokens (M)</span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-text-secondary">Masa Aktif</label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium text-violet-400">
                <input
                  type="checkbox"
                  checked={noExpiry}
                  onChange={(e) => setNoExpiry(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border-primary text-violet-500 focus:ring-violet-500"
                />
                <span>No Expired (∞)</span>
              </label>
            </div>
            {!noExpiry ? (
              <>
                <input
                  type="number"
                  min="1"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder="28"
                  className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                {days && daysValid && (
                  <p className="text-xs text-text-muted mt-1">
                    Expired: {new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toLocaleDateString("id-ID", { year: "numeric", month: "long", day: "numeric" })}
                  </p>
                )}
              </>
            ) : (
              <div className="p-2.5 rounded-md border border-violet-400/30 bg-violet-500/10 text-xs font-medium text-violet-300">
                Key tidak akan pernah expired (expires_at = null)
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              <KeyRound className="h-4 w-4" />
              Create Key
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
