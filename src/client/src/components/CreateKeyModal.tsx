import { useState, useEffect } from "react";
import { KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api } from "../lib/api";
import { SuccessModal } from "./SuccessModal";

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
    expires_at: string;
  };
}

export function CreateKeyModal({ open, onOpenChange, onSuccess }: CreateKeyModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateKeyResult | null>(null);
  const [userName, setUserName] = useState("");
  const [days, setDays] = useState("");
  const [rateLimitRpm, setRateLimitRpm] = useState("");

  useEffect(() => {
    if (open) {
      setResult(null);
      setUserName("");
      setDays("");
      setRateLimitRpm("");
    }
  }, [open]);

  const daysNum = parseInt(days, 10);
  const daysValid = !isNaN(daysNum) && daysNum > 0;
  const rpmNum = parseInt(rateLimitRpm, 10);
  const rpmValid = rateLimitRpm === "" || (!isNaN(rpmNum) && rpmNum > 0);

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
      toast("Rate limit harus berupa angka positif atau dikosongkan", "error");
      return;
    }
    setLoading(true);
    try {
      const data = await api<CreateKeyResult>("/admin/create-key", {
        method: "POST",
        body: JSON.stringify({
          name: userName.trim(),
          days: daysNum,
          rateLimitRpm: rpmValid && rateLimitRpm !== "" ? rpmNum : null
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
            Enter buyer name and number of active days
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
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Aktif (hari)</label>
            <input
              type="number"
              min="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="Contoh: 14"
              className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            {days && daysValid && (
              <p className="text-xs text-text-muted mt-1">
                Expired: {new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toLocaleDateString("id-ID", { year: "numeric", month: "long", day: "numeric" })}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Rate Limit (request/menit)</label>
            <input
              type="number"
              min="1"
              value={rateLimitRpm}
              onChange={(e) => setRateLimitRpm(e.target.value)}
              placeholder="Kosongkan untuk pakai default"
              className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-text-muted mt-1">
              Batas request per menit. Kosongkan untuk menggunakan default sistem.
            </p>
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