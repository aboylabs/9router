import { useState } from "react";
import { Settings2, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api } from "../lib/api";

interface BulkUpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function BulkUpdateModal({ open, onOpenChange, onSuccess }: BulkUpdateModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"rpm" | "requests" | "daily">("rpm");
  const [value, setValue] = useState("");
  const [dailyEnabled, setDailyEnabled] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "daily") {
      const action = dailyEnabled ? "enable" : "disable";
      const confirmMsg = dailyEnabled
        ? "Enable daily reset untuk SEMUA key yang punya max token?\n\nused_tokens akan di-reset ke 0 setiap 00:00 WIB."
        : "Disable daily reset untuk SEMUA key yang sedang ON?";
      if (!confirm(confirmMsg)) return;

      setLoading(true);
      try {
        const res = await api<{ updated: number; message: string }>("/admin/keys/bulk-daily-reset", {
          method: "PATCH",
          body: JSON.stringify({ daily_reset: dailyEnabled })
        });
        toast(res.message || `Daily reset ${action}d for ${res.updated ?? 0} key(s)`);
        onSuccess();
        onOpenChange(false);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Gagal memperbarui daily reset", "error");
      } finally {
        setLoading(false);
      }
      return;
    }

    const num = parseInt(value, 10);
    const isValid = value === "" || (!isNaN(num) && num > 0);

    if (!isValid) {
      toast("Nilai harus berupa angka positif atau dikosongkan", "error");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "rpm" ? "/admin/keys/bulk-rate-limit" : "/admin/keys/bulk-request-limit";
      const payload = mode === "rpm"
        ? { rate_limit_rpm: value === "" ? null : num }
        : { quota_requests: value === "" ? null : num };

      await api(endpoint, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      toast(`Berhasil memperbarui ${mode === "rpm" ? "Rate Limit" : "Request Limit"} untuk semua key aktif`);
      onSuccess();
      onOpenChange(false);
      setValue("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Gagal memperbarui", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Bulk Update Limits</DialogTitle>
          <DialogDescription>
            Terapkan batas ke semua API key yang aktif sekaligus.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="flex gap-1 p-1 bg-surface-tertiary rounded-md">
            <button
              type="button"
              onClick={() => setMode("rpm")}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === "rpm" ? "bg-surface-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              RPM
            </button>
            <button
              type="button"
              onClick={() => setMode("requests")}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === "requests" ? "bg-surface-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              Request
            </button>
            <button
              type="button"
              onClick={() => setMode("daily")}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === "daily" ? "bg-surface-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              Daily Reset
            </button>
          </div>

          {mode === "daily" ? (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                Reset <code className="text-text-primary">used_tokens</code> ke 0 setiap <strong>00:00 WIB</strong>.
                Hanya key yang punya max token (skip unlimited / Super Admin).
              </p>
              <div className="flex gap-2 p-1 bg-surface-tertiary rounded-md">
                <button
                  type="button"
                  onClick={() => setDailyEnabled(true)}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    dailyEnabled ? "bg-sky-500/20 text-sky-400 shadow-sm" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  Enable All
                </button>
                <button
                  type="button"
                  onClick={() => setDailyEnabled(false)}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                    !dailyEnabled ? "bg-surface-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  Disable All
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                {mode === "rpm" ? "Rate Limit (request/menit)" : "Request Limit (total request)"}
              </label>
              <input
                type="number"
                min="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Kosongkan untuk unlimited / default"
                className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
              />
              <p className="text-xs text-text-muted mt-1">
                {mode === "rpm"
                  ? "Kosongkan untuk kembali ke default sistem."
                  : "Kosongkan untuk unlimited request."}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {mode === "daily" ? <RefreshCw className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
              {mode === "daily" ? (dailyEnabled ? "Enable All" : "Disable All") : "Apply to All"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
