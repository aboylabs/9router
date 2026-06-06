import { useState, useEffect } from "react";
import { Gauge } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api } from "../lib/api";

interface EditRpmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyId: string | null;
  currentRpm: number | null;
  onSuccess: () => void;
}

export function EditRpmModal({ open, onOpenChange, keyId, currentRpm, onSuccess }: EditRpmModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [rpm, setRpm] = useState("");

  useEffect(() => {
    if (open) {
      setRpm(currentRpm !== null ? String(currentRpm) : "");
    }
  }, [open, currentRpm]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyId) return;

    const rpmNum = parseInt(rpm, 10);
    const rpmValid = rpm === "" || (!isNaN(rpmNum) && rpmNum > 0);

    if (!rpmValid) {
      toast("Rate limit harus berupa angka positif atau dikosongkan", "error");
      return;
    }

    setLoading(true);
    try {
      await api(`/admin/keys/${keyId}/rate-limit`, {
        method: "PATCH",
        body: JSON.stringify({
          rate_limit_rpm: rpmValid && rpm !== "" ? rpmNum : null
        })
      });
      toast("Rate limit updated");
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update rate limit", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Rate Limit</DialogTitle>
          <DialogDescription>
            Ubah batas request per menit untuk API key ini. Kosongkan untuk menggunakan default sistem.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Rate Limit (request/menit)</label>
            <input
              type="number"
              min="1"
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
              placeholder="Kosongkan untuk default"
              className="w-full px-3 py-2 rounded-md border border-border-primary bg-surface-primary text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              <Gauge className="h-4 w-4" />
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
