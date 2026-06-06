import { useState } from "react";
import { Settings2 } from "lucide-react";
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
  const [mode, setMode] = useState<"rpm" | "requests">("rpm");
  const [value, setValue] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
          <div className="flex gap-2 p-1 bg-surface-tertiary rounded-md">
            <button
              type="button"
              onClick={() => setMode("rpm")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "rpm" ? "bg-surface-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              Rate Limit (RPM)
            </button>
            <button
              type="button"
              onClick={() => setMode("requests")}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "requests" ? "bg-surface-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}
            >
              Request Limit
            </button>
          </div>

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

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              <Settings2 className="h-4 w-4" />
              Apply to All
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
