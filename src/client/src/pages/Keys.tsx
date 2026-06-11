import { useState } from "react";
import { Plus, Search, ClockArrowUp, Coins, Gauge, X, Settings2, Edit, Eye, EyeOff } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { CopyButton } from "../components/CopyButton";
import { CreateKeyModal } from "../components/CreateKeyModal";
import { AddTokensModal } from "../components/AddTokensModal";
import { ExtendKeysModal } from "../components/ExtendKeysModal";
import { EditRpmModal } from "../components/EditRpmModal";
import { BulkUpdateModal } from "../components/BulkUpdateModal";
import { useToast } from "../components/ui/Toast";
import { api } from "../lib/api";
import { buildCopyText } from "../lib/copy";
import { formatDateShort, formatTokens } from "../lib/utils";
import type { Key } from "../hooks/useDashboard";

interface KeysPageProps {
  keys: Key[];
  onRefresh: () => void;
}

export function Keys({ keys, onRefresh }: KeysPageProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [addTokensOpen, setAddTokensOpen] = useState(false);
  const [extendKeysOpen, setExtendKeysOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState("");
  const [extendLoading, setExtendLoading] = useState(false);
  const [addQuotaId, setAddQuotaId] = useState<string | null>(null);
  const [addQuotaTokens, setAddQuotaTokens] = useState("");
  const [addQuotaLoading, setAddQuotaLoading] = useState(false);
  const [editRpmId, setEditRpmId] = useState<string | null>(null);
  const [editRpmCurrent, setEditRpmCurrent] = useState<number | null>(null);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [editNameLoading, setEditNameLoading] = useState(false);
  const [showFullKey, setShowFullKey] = useState<string | null>(null);

  const filtered = keys.filter((key) => {
    const q = search.toLowerCase();
    return (
      key.buyer_name.toLowerCase().includes(q) ||
      key.key_prefix.toLowerCase().includes(q) ||
      (key.buyer_email?.toLowerCase().includes(q) ?? false) ||
      (key.key_plain?.toLowerCase().includes(q) ?? false)
    );
  });

  async function revokeKey(keyId: string) {
    if (!confirm("Are you sure you want to delete this API key? This cannot be undone.")) return;
    setRevoking(keyId);
    try {
      await api(`/admin/keys/${keyId}/delete`, { method: "PATCH" });
      toast("API key deleted");
      onRefresh();
    } catch {
      toast("Failed to delete key", "error");
    } finally {
      setRevoking(null);
    }
  }

  async function extendKey() {
    if (!extendingId || !extendDays) return;
    const days = parseInt(extendDays, 10);
    if (isNaN(days) || days <= 0) {
      toast("Enter a valid number of days", "error");
      return;
    }
    const targetKey = keys.find((k) => k.id === extendingId);
    const baseDate = targetKey?.expires_at ? new Date(targetKey.expires_at) : new Date();
    const newExpiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    setExtendLoading(true);
    try {
      await api(`/admin/keys/${extendingId}/extend`, { method: "POST", body: JSON.stringify({ expires_at: newExpiresAt }) });
      toast(`Extended by ${days} day${days !== 1 ? "s" : ""}`);
      setExtendingId(null);
      setExtendDays("");
      onRefresh();
    } catch {
      toast("Failed to extend key", "error");
    } finally {
      setExtendLoading(false);
    }
  }

  async function addQuota() {
    if (!addQuotaId || !addQuotaTokens) return;
    const tokens = parseInt(addQuotaTokens, 10);
    if (isNaN(tokens) || tokens <= 0) {
      toast("Enter a valid token amount", "error");
      return;
    }
    setAddQuotaLoading(true);
    try {
      await api("/admin/keys/add-tokens", { method: "POST", body: JSON.stringify({ keyIds: [addQuotaId], tokens }) });
      toast(`Added ${formatQuotaHelper(addQuotaTokens)} to key`);
      setAddQuotaId(null);
      setAddQuotaTokens("");
      onRefresh();
    } catch {
      toast("Failed to add quota", "error");
    } finally {
      setAddQuotaLoading(false);
    }
  }

  function formatQuotaHelper(val: string): string {
    const n = parseInt(val, 10);
    if (isNaN(n) || n <= 0) return "";
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B tokens`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tokens`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K tokens`;
    return `${n} tokens`;
  }

  function getCopyText(key: Key): string {
    return buildCopyText({
      email: key.buyer_email || "-",
      password: "-", // Password no longer stored for security
      apiKey: key.key_plain || key.key_prefix + "...",
      quotaTokens: key.quota_tokens || "unlimited",
      expiresAt: key.expires_at,
      dailyReset: key.daily_reset,
      dailyQuotaTokens: key.daily_quota_tokens
    });
  }

  function getEffectiveQuota(key: Key): string | null {
    if (key.daily_reset && key.daily_quota_tokens) return key.daily_quota_tokens;
    return key.quota_tokens;
  }

  async function updateBuyerName() {
    if (!editingNameId || !editNameValue.trim()) return;
    setEditNameLoading(true);
    try {
      await api(`/admin/buyers/${editingNameId}`, { method: "PATCH", body: JSON.stringify({ name: editNameValue.trim() }) });
      toast("Buyer name updated");
      setEditingNameId(null);
      setEditNameValue("");
      onRefresh();
    } catch {
      toast("Failed to update name", "error");
    } finally {
      setEditNameLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">API Keys</h2>
          <p className="text-sm text-text-muted">Manage buyer API keys</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setBulkUpdateOpen(true)}>
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Bulk</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setExtendKeysOpen(true)}>
            <ClockArrowUp className="h-4 w-4" />
            <span className="hidden sm:inline">Extend</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAddTokensOpen(true)}>
            <Coins className="h-4 w-4" />
            <span className="hidden sm:inline">Tokens</span>
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create</span>
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search by buyer, email, or prefix..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
        />
      </div>

      {/* Mobile card view */}
      <div className="lg:hidden space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">{search ? "No keys match your search" : "No API keys created yet"}</p>
        ) : (
          filtered.map((key) => {
            const effectiveQuota = getEffectiveQuota(key);
            const pct = effectiveQuota ? Math.min(100, (Number(key.used_tokens) / Number(effectiveQuota)) * 100) : 0;
            const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-primary-500";
            return (
              <div key={key.id} className="border border-border rounded-lg p-3 space-y-2 bg-surface">
                <div className="flex items-center justify-between">
                  {editingNameId === key.buyer_id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        className="h-7 w-32 rounded border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        autoFocus
                      />
                      <Button size="sm" onClick={updateBuyerName} loading={editNameLoading}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingNameId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-text-primary text-sm">{key.buyer_name}</span>
                      <button
                        onClick={() => { setEditingNameId(key.buyer_id); setEditNameValue(key.buyer_name); }}
                        className="text-text-muted hover:text-text-primary transition-colors"
                        title="Edit name"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {key.revoked_at ? (
                    <Badge variant="danger">Revoked</Badge>
                  ) : key.expires_at && new Date(key.expires_at) < new Date() ? (
                    <Badge variant="warning">Expired</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono max-w-[200px] truncate" title={showFullKey === key.id ? key.key_plain : key.key_prefix}>
                    {showFullKey === key.id ? key.key_plain : key.key_prefix}
                  </code>
                  <button
                    onClick={() => setShowFullKey(showFullKey === key.id ? null : key.id)}
                    className="text-text-muted hover:text-text-primary transition-colors"
                    title={showFullKey === key.id ? "Hide full key" : "Show full key"}
                  >
                    {showFullKey === key.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <CopyButton text={key.key_plain || key.key_prefix} />
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>{formatTokens(key.used_tokens)} / {effectiveQuota ? formatTokens(effectiveQuota) : "unlimited"}{key.daily_reset ? " /day" : ""}</span>
                  <span>{pct.toFixed(0)}%</span>
                </div>
                {effectiveQuota && (
                  <div className="w-full h-1.5 bg-surface-tertiary rounded-full">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-text-muted pt-1">
                  <span>Requests: <span className="text-text-primary font-medium">{Number(key.used_requests).toLocaleString()}</span></span>
                  <span>RPM: <span className="text-text-primary font-medium">{key.rate_limit_rpm ? `${key.rate_limit_rpm}` : "default"}</span></span>
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>Expires: {formatDateShort(key.expires_at)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                   <CopyButton text={getCopyText(key)} />
                   {!key.revoked_at && (
                     <>
                       <Button
                         variant="secondary"
                         size="sm"
                         onClick={() => { setExtendingId(key.id); setExtendDays(""); setAddQuotaId(null); setEditRpmId(null); }}
                       >
                         <ClockArrowUp className="h-3.5 w-3.5" />
                         Extend
                       </Button>
                       <Button
                         variant="secondary"
                         size="sm"
                         onClick={() => { setAddQuotaId(key.id); setAddQuotaTokens(""); setExtendingId(null); setEditRpmId(null); }}
                       >
                         <Coins className="h-3.5 w-3.5" />
                         Quota
                       </Button>
                       <Button
                         variant="secondary"
                         size="sm"
                         onClick={() => { setEditRpmId(key.id); setEditRpmCurrent(key.rate_limit_rpm); setExtendingId(null); setAddQuotaId(null); }}
                       >
                         <Gauge className="h-3.5 w-3.5" />
                         RPM
                       </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => revokeKey(key.id)}
                          loading={revoking === key.id}
                        >
                          <X className="h-3.5 w-3.5" />
                          Del
                        </Button>
                      </>
                    )}
                  </div>
                 {extendingId === key.id && (
                   <div className="flex items-center gap-2 pt-1">
                     <input
                       type="number"
                       min="1"
                       placeholder="Days"
                       value={extendDays}
                       onChange={(e) => setExtendDays(e.target.value)}
                       className="h-7 w-20 rounded border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                     />
                     <Button size="sm" onClick={extendKey} loading={extendLoading}>Extend</Button>
                     <Button size="sm" variant="secondary" onClick={() => setExtendingId(null)}>Cancel</Button>
                   </div>
                 )}
                 {addQuotaId === key.id && (
                   <div className="flex items-center gap-2 pt-1">
                     <input
                       type="number"
                       min="1"
                       placeholder="Tokens (e.g. 50000000)"
                       value={addQuotaTokens}
                       onChange={(e) => setAddQuotaTokens(e.target.value)}
                       className="h-7 w-32 rounded border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                     />
                     {addQuotaTokens && <span className="text-xs text-text-muted">{formatQuotaHelper(addQuotaTokens)}</span>}
                     <Button size="sm" onClick={addQuota} loading={addQuotaLoading}>Add</Button>
                     <Button size="sm" variant="secondary" onClick={() => setAddQuotaId(null)}>Cancel</Button>
                   </div>
                 )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden lg:block w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Name</TableHead>
              <TableHead className="whitespace-nowrap">API Key</TableHead>
              <TableHead className="whitespace-nowrap">Request</TableHead>
              <TableHead className="whitespace-nowrap">RPM Limit</TableHead>
              <TableHead className="whitespace-nowrap">Token Usage</TableHead>
              <TableHead className="whitespace-nowrap">Created</TableHead>
              <TableHead className="whitespace-nowrap">Expired</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
          {filtered.length === 0 ? (
            <TableEmpty colSpan={9} message={search ? "No keys match your search" : "No API keys created yet"} />
          ) : (
            filtered.map((key) => {
              const effectiveQuota = getEffectiveQuota(key);
              return (
              <TableRow key={key.id}>
                <TableCell className="font-medium text-text-primary">
                  {editingNameId === key.buyer_id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        className="h-7 w-32 rounded border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        autoFocus
                      />
                      <Button size="sm" onClick={updateBuyerName} loading={editNameLoading}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingNameId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span>{key.buyer_name}</span>
                      <button
                        onClick={() => { setEditingNameId(key.buyer_id); setEditNameValue(key.buyer_name); }}
                        className="text-text-muted hover:text-text-primary transition-colors"
                        title="Edit name"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono max-w-[180px] truncate" title={showFullKey === key.id ? key.key_plain : key.key_prefix}>
                      {showFullKey === key.id ? key.key_plain : key.key_prefix}
                    </code>
                    <button
                      onClick={() => setShowFullKey(showFullKey === key.id ? null : key.id)}
                      className="text-text-muted hover:text-text-primary transition-colors"
                      title={showFullKey === key.id ? "Hide full key" : "Show full key"}
                    >
                      {showFullKey === key.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <CopyButton text={key.key_plain || key.key_prefix} />
                  </div>
                </TableCell>
                <TableCell>{Number(key.used_requests).toLocaleString()}</TableCell>
                <TableCell>
                  <span className="text-sm">
                    {key.rate_limit_rpm ? (
                      <span className="text-text-primary font-medium">{key.rate_limit_rpm} rpm</span>
                    ) : (
                      <span className="text-text-muted italic">default</span>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{formatTokens(key.used_tokens)}</span>
                    <span className="text-text-muted">/</span>
                    <span>{effectiveQuota ? formatTokens(effectiveQuota) : "unlimited"}{key.daily_reset ? "/day" : ""}</span>
                  </div>
                  {effectiveQuota && (() => {
                    const pct = Math.min(100, (Number(key.used_tokens) / Number(effectiveQuota)) * 100);
                    const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-primary-500";
                    return (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-24 h-1.5 bg-surface-tertiary rounded-full">
                          <div
                            className={`h-full ${color} rounded-full transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-muted">{pct.toFixed(0)}%</span>
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell>{formatDateShort(key.created_at)}</TableCell>
                <TableCell>{formatDateShort(key.expires_at)}</TableCell>
                <TableCell>
                  {key.revoked_at ? (
                    <Badge variant="danger">Revoked</Badge>
                  ) : key.expires_at && new Date(key.expires_at) < new Date() ? (
                    <Badge variant="warning">Expired</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </TableCell>
                <TableCell>
                   <div className="flex items-center gap-1 whitespace-nowrap">
                     <CopyButton text={getCopyText(key)} />
                     {!key.revoked_at && (
                       <>
                         <Button
                           variant="secondary"
                           size="sm"
                           onClick={() => { setExtendingId(key.id); setExtendDays(""); setAddQuotaId(null); setEditRpmId(null); }}
                           title="Extend expiry"
                         >
                           <ClockArrowUp className="h-3.5 w-3.5" />
                         </Button>
                         <Button
                           variant="secondary"
                           size="sm"
                           onClick={() => { setAddQuotaId(key.id); setAddQuotaTokens(""); setExtendingId(null); setEditRpmId(null); }}
                           title="Add token quota"
                         >
                           <Coins className="h-3.5 w-3.5" />
                         </Button>
                         <Button
                           variant="secondary"
                           size="sm"
                           onClick={() => { setEditRpmId(key.id); setEditRpmCurrent(key.rate_limit_rpm); setExtendingId(null); setAddQuotaId(null); }}
                           title="Edit rate limit"
                         >
                           <Gauge className="h-3.5 w-3.5" />
                         </Button>
                         <Button
                           variant="danger"
                           size="sm"
                           onClick={() => revokeKey(key.id)}
                           loading={revoking === key.id}
                           title="Delete key"
                         >
                           <X className="h-3.5 w-3.5" />
                         </Button>
                       </>
                     )}
                   </div>
                   {extendingId === key.id && (
                     <div className="flex items-center gap-2 mt-1">
                       <input
                         type="number"
                         min="1"
                         placeholder="Days"
                         value={extendDays}
                         onChange={(e) => setExtendDays(e.target.value)}
                         className="h-7 w-20 rounded border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                       />
                       <Button size="sm" onClick={extendKey} loading={extendLoading}>Extend</Button>
                       <Button size="sm" variant="secondary" onClick={() => setExtendingId(null)}>Cancel</Button>
                     </div>
                   )}
                   {addQuotaId === key.id && (
                     <div className="flex items-center gap-2 mt-1">
                       <input
                         type="number"
                         min="1"
                         placeholder="Tokens (e.g. 50000000)"
                         value={addQuotaTokens}
                         onChange={(e) => setAddQuotaTokens(e.target.value)}
                         className="h-7 w-32 rounded border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                       />
                       {addQuotaTokens && <span className="text-xs text-text-muted">{formatQuotaHelper(addQuotaTokens)}</span>}
                       <Button size="sm" onClick={addQuota} loading={addQuotaLoading}>Add</Button>
                       <Button size="sm" variant="secondary" onClick={() => setAddQuotaId(null)}>Cancel</Button>
                     </div>
                   )}
                 </TableCell>
              </TableRow>
              );
            })
          )}
          </TableBody>
        </Table>
      </div>

      {/* Create Key Modal */}
      <CreateKeyModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={onRefresh}
      />

      {/* Add Tokens Modal */}
      <AddTokensModal
        open={addTokensOpen}
        onOpenChange={setAddTokensOpen}
        onSuccess={onRefresh}
        keys={keys}
      />

      {/* Extend Keys Modal */}
      <ExtendKeysModal
        open={extendKeysOpen}
        onOpenChange={setExtendKeysOpen}
        onSuccess={onRefresh}
        keys={keys}
      />

      {/* Edit RPM Modal */}
      <EditRpmModal
        open={editRpmId !== null}
        onOpenChange={(open) => { if (!open) setEditRpmId(null); }}
        keyId={editRpmId}
        currentRpm={editRpmCurrent}
        onSuccess={onRefresh}
      />

      {/* Bulk Update Modal */}
      <BulkUpdateModal
        open={bulkUpdateOpen}
        onOpenChange={setBulkUpdateOpen}
        onSuccess={onRefresh}
      />
    </div>
  );
}
