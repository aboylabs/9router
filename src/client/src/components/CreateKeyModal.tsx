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
    expires_at: string;
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
  const [packageId, setPackageId] = useState<CreateKeyPackageId>(DEFAULT_CREATE_KEY_PACKAGE_ID);
  const [days, setDays] = useState(String(CREATE_KEY_PACKAGES.find((p) => p.id === DEFAULT_CREATE_KEY_PACKAGE_ID)?.defaultDays ?? 28));

  const selectedPkg = useMemo(
    () => CREATE_KEY_PACKAGES.find((p) => p.id === packageId) ?? CREATE_KEY_PACKAGES[0],
    [packageId]
  );

  useEffect(() => {
    if (open) {
      setResult(null);
      setUserName("");
      setPackageId(DEFAULT_CREATE_KEY_PACKAGE_ID);
      const def = CREATE_KEY_PACKAGES.find((p) => p.id === DEFAULT_CREATE_KEY_PACKAGE_ID);
      setDays(String(def?.defaultDays ?? 28));
    }
  }, [open]);

  // When package changes, reset days to that package's default (admin can still edit after).
  useEffect(() => {
    if (!open) return;
    setDays(String(selectedPkg.defaultDays));
  }, [packageId]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only on package switch

  const daysNum = parseInt(days, 10);
  const daysValid = !isNaN(daysNum) && daysNum > 0;

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
    setLoading(true);
    try {
      const data = await api<CreateKeyResult>("/admin/create-key", {
        method: "POST",
        body: JSON.stringify({
          name: userName.trim(),
          days: daysNum,
          packageId
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
            Pilih paket (kuota + RPM otomatis). Hari aktif default 28, bisa diubah.
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
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Paket</label>
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value as CreateKeyPackageId)}
              className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {CREATE_KEY_PACKAGES.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.label} · {formatQuotaM(pkg.quotaTokens)} · {pkg.rateLimitRpm} RPM · {formatPriceId(pkg.priceRp)}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
              <span className="font-medium text-text-secondary">{selectedPkg.label}</span>
              {" · "}
              {formatQuotaM(selectedPkg.quotaTokens)} tokens
              {" · "}
              {selectedPkg.rateLimitRpm} RPM
              {" · "}
              {formatPriceId(selectedPkg.priceRp)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Aktif (hari)</label>
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
