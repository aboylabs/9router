import { useState, useMemo } from "react";
import { Coins, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { api } from "../lib/api";
import { formatTokens } from "../lib/utils";
import type { Key } from "../hooks/useDashboard";

interface AddTokensModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  keys: Key[];
}

export function AddTokensModal({ open, onOpenChange, onSuccess, keys }: AddTokensModalProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tokensInput, setTokensInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Only show non-daily-reset, active keys
  const eligibleKeys = useMemo(() => {
    return keys.filter(
      (k) => !k.revoked_at && k.expires_at && new Date(k.expires_at) > new Date() && !k.daily_reset
    );
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

  const tokensNum = parseInt(tokensInput, 10);
  const tokensValid = !isNaN(tokensNum) && tokensNum > 0;

  function formatHelper(val: string): string {
    const n = parseInt(val, 10);
    if (isNaN(n) || n <= 0) return "";
    if (n >= 1_000_000_000) return `= ${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B tokens`;
    if (n >= 1_000_000) return `= ${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tokens`;
    if (n >= 1_000) return `= ${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K tokens`;
    return `= ${n} tokens`;
  }

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

  async function submit() {
    if (!tokensValid) {
      toast("Enter a valid token amount", "error");
      return;
    }
    if (mode === "select" && selectedIds.size === 0) {
      toast("Select at least one key", "error");
      return;
    }

    setLoading(true);
    try {
      const payload: { tokens: number; all?: boolean; keyIds?: string[] } = { tokens: tokensNum };
      if (mode === "all") {
        payload.all = true;
      } else {
        payload.keyIds = Array.from(selectedIds);
      }

      const res = await api("/admin/keys/add-tokens", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = res as { updated: number; tokens_added: number };
      toast(`Added ${formatHelper(String(data.tokens_added)).replace("= ", "")} to ${data.updated} key${data.updated !== 1 ? "s" : ""}`);
      onOpenChange(false);
      resetForm();
      onSuccess();
    } catch {
      toast("Failed to add tokens", "error");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setMode("all");
    setSelectedIds(new Set());
    setTokensInput("");
    setSearch("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary-500" />
              Add Tokens
            </span>
          </DialogTitle>
          <DialogDescription>
            Add quota tokens to active keys (non-daily-reset only)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Target selection */}
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

          {/* Key selection list */}
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
                  <p className="text-sm text-text-muted text-center py-4">No eligible keys</p>
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
                          {key.buyer_email || "-"} &middot; {key.key_prefix} &middot; {key.quota_tokens ? formatTokens(key.quota_tokens) : "no quota"}
                        </div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Token amount */}
          <div className="space-y-1">
            <label className="text-sm font-medium text-text-primary">Tokens to add</label>
            <input
              type="number"
              min="1"
              placeholder="e.g. 50000000"
              value={tokensInput}
              onChange={(e) => setTokensInput(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
            />
            {tokensInput && (
              <p className="text-xs text-text-muted">{formatHelper(tokensInput)}</p>
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { onOpenChange(false); resetForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              loading={loading}
              disabled={!tokensValid || (mode === "select" && selectedIds.size === 0)}
            >
              Add Tokens
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
