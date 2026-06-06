import { useMemo, useState } from "react";
import { ClockArrowUp, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api } from "../lib/api";
import { formatDateShort } from "../lib/utils";
import type { Key } from "../hooks/useDashboard";

interface ExtendKeysModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  keys: Key[];
}

export function ExtendKeysModal({ open, onOpenChange, onSuccess, keys }: ExtendKeysModalProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expiresAt, setExpiresAt] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const eligibleKeys = useMemo(() => {
    return keys.filter((key) => !key.revoked_at && key.expires_at && new Date(key.expires_at) > new Date());
  }, [keys]);

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return eligibleKeys;
    return eligibleKeys.filter((key) =>
      key.buyer_name.toLowerCase().includes(q) ||
      (key.buyer_email?.toLowerCase().includes(q) ?? false) ||
      key.key_prefix.toLowerCase().includes(q)
    );
  }, [eligibleKeys, search]);

  const expiresDate = new Date(expiresAt);
  const dateValid = expiresAt && !isNaN(expiresDate.getTime()) && expiresDate > new Date();

  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);
  const minDateStr = minDate.toISOString().split("T")[0];

  function toggleKey(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filteredKeys.map((key) => key.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function resetForm() {
    setMode("all");
    setSelectedIds(new Set());
    setExpiresAt("");
    setSearch("");
  }

  async function submit() {
    if (!dateValid) {
      toast("Enter a valid future date", "error");
      return;
    }
    if (mode === "select" && selectedIds.size === 0) {
      toast("Select at least one key", "error");
      return;
    }

    setLoading(true);
    try {
      const payload: { expires_at: string; all?: boolean; keyIds?: string[] } = { expires_at: expiresAt };
      if (mode === "all") {
        payload.all = true;
      } else {
        payload.keyIds = Array.from(selectedIds);
      }

      const data = await api<{ updated: number }>("/admin/keys/extend", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast(`Extended ${data.updated} active key${data.updated !== 1 ? "s" : ""} to ${formatDateShort(expiresAt)}`);
      onOpenChange(false);
      resetForm();
      onSuccess();
    } catch {
      toast("Failed to extend keys", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value) resetForm(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <ClockArrowUp className="h-5 w-5 text-primary-500" />
              Extend Keys
            </span>
          </DialogTitle>
          <DialogDescription>
            Set a new expiry date for active, non-revoked keys
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Target</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("all")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  mode === "all"
                    ? "border-primary-500 bg-primary-500/10 text-primary-500"
                    : "border-border bg-surface text-text-muted hover:border-text-muted"
                }`}
              >
                All active keys ({eligibleKeys.length})
              </button>
              <button
                type="button"
                onClick={() => setMode("select")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  mode === "select"
                    ? "border-primary-500 bg-primary-500/10 text-primary-500"
                    : "border-border bg-surface text-text-muted hover:border-text-muted"
                }`}
              >
                Select keys
              </button>
            </div>
          </div>

          {mode === "select" && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search buyer, email, or key..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">
                  {selectedIds.size} selected &middot; {filteredKeys.length} of {eligibleKeys.length} keys
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={selectAll} className="text-xs text-primary-500 hover:underline">Select all shown</button>
                  <button type="button" onClick={deselectAll} className="text-xs text-text-muted hover:underline">Clear</button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border">
                {eligibleKeys.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-4">No active keys</p>
                ) : filteredKeys.length === 0 ? (
                  <p className="text-sm text-text-muted text-center py-4">No keys match your search</p>
                ) : (
                  filteredKeys.map((key) => (
                    <label
                      key={key.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-surface-secondary cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(key.id)}
                        onChange={() => toggleKey(key.id)}
                        className="rounded border-border"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-primary truncate">{key.buyer_name}</div>
                        <div className="text-xs text-text-muted">
                          {key.buyer_email || "-"} &middot; {key.key_prefix} &middot; expires {formatDateShort(key.expires_at)}
                        </div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium text-text-primary">New expiry date</label>
            <input
              type="date"
              min={minDateStr}
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { onOpenChange(false); resetForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={loading}
              disabled={!dateValid || (mode === "select" && selectedIds.size === 0)}
            >
              Extend Keys
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}