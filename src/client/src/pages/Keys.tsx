import { useState } from "react";
import { Plus, Search, ClockArrowUp, Coins, Gauge, X, Settings2, Edit, Eye, EyeOff, RefreshCw, Infinity as InfinityIcon } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { CopyButton } from "../components/CopyButton";
import { CreateKeyModal } from "../components/CreateKeyModal";
import { AddTokensModal } from "../components/AddTokensModal";
import { ExtendKeysModal } from "../components/ExtendKeysModal";
import { EditRpmModal } from "../components/EditRpmModal";
import { BulkUpdateModal } from "../components/BulkUpdateModal";
import { SuperAdminBadge } from "../components/SuperAdminBadge";
import { SupporterBadge } from "../components/SupporterBadge";
import { HelperBadge } from "../components/HelperBadge";
import { UltraBadge } from "../components/UltraBadge";
import { useToast } from "../components/ui/Toast";
import { api } from "../lib/api";
import { buildCopyText } from "../lib/copy";
import { formatRemaining, formatTokens, buyerNameClassName, isSuperAdminName, isSupporterName, isHelperName, isUltraQuota } from "../lib/utils";
import type { Key } from "../hooks/useDashboard";

interface KeysPageProps {
  keys: Key[];
  onRefresh: () => void;
}

const QUOTA_PRESETS = [
  { value: 100_000_000, label: "100M" },
  { value: 200_000_000, label: "200M" },
  { value: 300_000_000, label: "300M" },
  { value: 500_000_000, label: "500M" }
] as const;

function fullKey(key: Key): string {
  return (key as any)["key_plain"] || key.key_prefix;
}

function isUnlimitedKey(key: Key): boolean {
  return key.quota_tokens == null || key.quota_tokens === "";
}

export function Keys({ keys, onRefresh }: KeysPageProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [addTokensOpen, setAddTokensOpen] = useState(false);
  const [extendKeysOpen, setExtendKeysOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [editRpmId, setEditRpmId] = useState<string | null>(null);
  const [editRpmCurrent, setEditRpmCurrent] = useState<number | null>(null);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [editNameLoading, setEditNameLoading] = useState(false);
  const [showFullKey, setShowFullKey] = useState<string | null>(null);
  const [dailyResetLoading, setDailyResetLoading] = useState<string | null>(null);
  const [setQuotaId, setSetQuotaId] = useState<string | null>(null);
  const [quotaLoading, setQuotaLoading] = useState<string | null>(null);

  const filtered = keys.filter((key) => {
    const q = search.toLowerCase();
    const plain = ((key as any)["key_plain"] as string | undefined)?.toLowerCase() ?? "";
    return (
      key.buyer_name.toLowerCase().includes(q) ||
      key.key_prefix.toLowerCase().includes(q) ||
      (key.buyer_email?.toLowerCase().includes(q) ?? false) ||
      plain.includes(q)
    );
  });

  function closeInlineEditors() {
    setEditRpmId(null);
    setSetQuotaId(null);
  }

  async function revokeKey(keyId: string) {
    if (!confirm("Are you sure you want to delete this API key? This cannot be undone.")) return;
    setRevoking(keyId);
    try {
      await api(`/admin/keys/${keyId}/delete`, { method: "PATCH" });
      toast("API key deleted");
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete key", "error");
    } finally {
      setRevoking(null);
    }
  }

  function getCopyText(key: Key): string {
    return buildCopyText({
      email: key.buyer_email || "-",
      password: "-",
      apiKey: fullKey(key),
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
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update name", "error");
    } finally {
      setEditNameLoading(false);
    }
  }

  async function toggleDailyReset(key: Key) {
    if (!key.daily_reset && isUnlimitedKey(key)) {
      toast("Key unlimited — set max token dulu sebelum enable daily reset", "error");
      return;
    }
    setDailyResetLoading(key.id);
    try {
      await api(`/admin/keys/${key.id}/daily-reset`, {
        method: "PATCH",
        body: JSON.stringify({ daily_reset: !key.daily_reset })
      });
      toast(key.daily_reset ? "Daily reset OFF" : "Daily reset ON (00:00 WIB)");
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to toggle daily reset", "error");
    } finally {
      setDailyResetLoading(null);
    }
  }

  async function makeUnlimited(key: Key) {
    if (isUnlimitedKey(key)) return;
    if (!confirm(`Jadikan unlimited token untuk ${key.buyer_name}?\n\nDaily reset akan dimatikan. Masa aktif (expiry) tidak diubah.`)) {
      return;
    }
    setQuotaLoading(key.id);
    try {
      await api(`/admin/keys/${key.id}/token-quota`, {
        method: "PATCH",
        body: JSON.stringify({ quota_tokens: null })
      });
      toast(`Unlimited ON · ${key.buyer_name}`);
      closeInlineEditors();
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to set unlimited", "error");
    } finally {
      setQuotaLoading(null);
    }
  }

  async function setFiniteQuota(keyId: string, quotaTokens: number, label: string) {
    setQuotaLoading(keyId);
    try {
      await api(`/admin/keys/${keyId}/token-quota`, {
        method: "PATCH",
        body: JSON.stringify({ quota_tokens: quotaTokens })
      });
      toast(`Quota set to ${label}`);
      setSetQuotaId(null);
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to set token quota", "error");
    } finally {
      setQuotaLoading(null);
    }
  }

  const iconBtn =
    "h-8 w-8 p-0 shrink-0 inline-flex items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary hover:bg-surface-tertiary hover:border-border-hover transition-colors disabled:opacity-50 shadow-sm";
  const iconBtnActiveDaily =
    "h-8 w-8 p-0 shrink-0 inline-flex items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400 hover:bg-sky-500/25 transition-colors disabled:opacity-50 shadow-sm";
  const iconBtnActiveUnlimited =
    "h-8 w-8 p-0 shrink-0 inline-flex items-center justify-center rounded-lg border border-violet-500/45 bg-violet-500/15 text-violet-600 dark:text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-50 shadow-sm shadow-[0_0_12px_rgba(167,139,250,0.25)]";
  const iconBtnDanger =
    "h-8 w-8 p-0 shrink-0 inline-flex items-center justify-center rounded-lg border border-red-500/30 bg-danger text-white hover:bg-red-600 transition-colors disabled:opacity-50 shadow-sm";

  // Per-row actions: Copy · ∞ · RPM · Daily · Delete
  // Extend + Add Tokens live in the top toolbar (near Create) — no row duplicates.
  function ActionButtons({ keyRow, compact = false }: { keyRow: Key; compact?: boolean }) {
    if (keyRow.revoked_at) {
      return <CopyButton text={getCopyText(keyRow)} />;
    }
    const unlimited = isUnlimitedKey(keyRow);
    return (
      <div className={`flex items-center ${compact ? "gap-1.5" : "gap-2"} flex-wrap`}>
        <CopyButton text={getCopyText(keyRow)} />
        <button
          type="button"
          className={unlimited ? iconBtnActiveUnlimited : iconBtn}
          title={unlimited ? "Remove unlimited — set finite quota" : "Make unlimited token"}
          disabled={quotaLoading === keyRow.id}
          onClick={() => {
            if (unlimited) {
              setSetQuotaId(keyRow.id);
              setEditRpmId(null);
            } else {
              void makeUnlimited(keyRow);
            }
          }}
        >
          <InfinityIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
        </button>
        <button
          type="button"
          className={iconBtn}
          title="Edit rate limit"
          onClick={() => {
            setEditRpmId(keyRow.id);
            setEditRpmCurrent(keyRow.rate_limit_rpm);
            setSetQuotaId(null);
          }}
        >
          <Gauge className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={keyRow.daily_reset ? iconBtnActiveDaily : iconBtn}
          title={
            unlimited
              ? "Unlimited key — set max token first"
              : keyRow.daily_reset
                ? "Disable daily quota reset"
                : "Enable daily quota reset at 00:00 WIB"
          }
          disabled={dailyResetLoading === keyRow.id || unlimited}
          onClick={() => toggleDailyReset(keyRow)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={iconBtnDanger}
          title="Delete key"
          disabled={revoking === keyRow.id}
          onClick={() => revokeKey(keyRow.id)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  function InlineEditor({ keyRow }: { keyRow: Key }) {
    return (
      <>
        {setQuotaId === keyRow.id && (
          <div className="mt-2 p-2.5 rounded-md bg-surface-secondary border border-border space-y-2">
            <div className="text-[11px] font-medium text-text-secondary">
              Hapus unlimited · pilih kuota token
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUOTA_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={quotaLoading === keyRow.id}
                  onClick={() => void setFiniteQuota(keyRow.id, p.value, p.label)}
                  className="h-8 px-2.5 rounded-lg border border-violet-500/35 bg-violet-500/10 text-xs font-semibold text-violet-700 dark:text-violet-200 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setSetQuotaId(null)}>Cancel</Button>
            </div>
            <p className="text-[10px] text-text-muted leading-snug">
              used_tokens tidak di-reset. Kalau sudah melebihi kuota baru, key langsung terblokir.
            </p>
          </div>
        )}
      </>
    );
  }

  function StatusBlock({ keyRow }: { keyRow: Key }) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        {keyRow.revoked_at ? (
          <Badge variant="danger">Revoked</Badge>
        ) : keyRow.expires_at && new Date(keyRow.expires_at) < new Date() ? (
          <Badge variant="warning">Expired</Badge>
        ) : (
          <Badge variant="success">Active</Badge>
        )}
        {isUnlimitedKey(keyRow) && (
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-300 whitespace-nowrap">
            <InfinityIcon className="h-2.5 w-2.5" strokeWidth={2.6} />
            Unlimited
          </span>
        )}
        {keyRow.daily_reset && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400 whitespace-nowrap">
            <RefreshCw className="h-2.5 w-2.5" />
            Daily 00:00
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">API Keys</h2>
          <p className="text-sm text-text-muted mt-0.5">Manage buyer API keys · {filtered.length} shown</p>
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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search by buyer, email, or prefix..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors shadow-sm"
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
            const displayed = showFullKey === key.id ? fullKey(key) : key.key_prefix;
            return (
              <div key={key.id} className="border border-border rounded-xl p-4 space-y-3 bg-surface shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  {editingNameId === key.buyer_id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        className="h-8 flex-1 rounded border border-border bg-surface px-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        autoFocus
                      />
                      <Button size="sm" onClick={updateBuyerName} loading={editNameLoading}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingNameId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-medium text-sm truncate ${buyerNameClassName(key.buyer_name, key.quota_tokens)}`}>{key.buyer_name}</span>
                      {isSuperAdminName(key.buyer_name) ? <SuperAdminBadge /> : null}
                      {isSupporterName(key.buyer_name) ? <SupporterBadge /> : null}
                      {isHelperName(key.buyer_name) ? <HelperBadge /> : null}
                      {!isSuperAdminName(key.buyer_name) && !isSupporterName(key.buyer_name) && !isHelperName(key.buyer_name) && isUltraQuota(key.quota_tokens) ? <UltraBadge /> : null}
                      <button
                        onClick={() => { setEditingNameId(key.buyer_id); setEditNameValue(key.buyer_name); }}
                        className="text-text-muted hover:text-text-primary transition-colors shrink-0"
                        title="Edit name"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBlock keyRow={key} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <code className="text-xs bg-surface-tertiary px-2 py-1 rounded-md font-mono flex-1 min-w-0 truncate" title={displayed}>
                    {displayed}
                  </code>
                  <button
                    onClick={() => setShowFullKey(showFullKey === key.id ? null : key.id)}
                    className="text-text-muted hover:text-text-primary transition-colors shrink-0"
                    title={showFullKey === key.id ? "Hide full key" : "Show full key"}
                  >
                    {showFullKey === key.id ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <CopyButton text={fullKey(key)} />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span className="font-medium text-text-secondary">
                      {formatTokens(key.used_tokens)} / {effectiveQuota ? formatTokens(effectiveQuota) : "unlimited"}
                      {key.daily_reset ? " /day" : ""}
                    </span>
                    <span>{effectiveQuota ? `${pct.toFixed(0)}%` : "∞"}</span>
                  </div>
                  {effectiveQuota && (
                    <div className="w-full h-2 bg-surface-tertiary rounded-full">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-text-muted">
                  <span>Requests: <span className="text-text-primary font-medium">{Number(key.used_requests).toLocaleString()}</span></span>
                  <span className="text-right">RPM: <span className="text-text-primary font-medium">{key.rate_limit_rpm ? `${key.rate_limit_rpm}` : "default"}</span></span>
                  <span className="col-span-2">Sisa: <span className={`font-medium ${
                    (() => {
                      const r = formatRemaining(key.expires_at);
                      return r.tone === "danger" ? "text-red-400" : r.tone === "warn" ? "text-yellow-400" : r.tone === "ok" ? "text-emerald-400" : "text-text-primary";
                    })()
                  }`}>{formatRemaining(key.expires_at).label}</span></span>
                </div>

                <div className="pt-1 border-t border-border">
                  <ActionButtons keyRow={key} />
                  <InlineEditor keyRow={key} />
                </div>
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
              <TableHead className="whitespace-nowrap min-w-[140px]">Name</TableHead>
              <TableHead className="whitespace-nowrap min-w-[180px]">API Key</TableHead>
              <TableHead className="whitespace-nowrap">Requests</TableHead>
              <TableHead className="whitespace-nowrap">RPM</TableHead>
              <TableHead className="whitespace-nowrap min-w-[180px]">Token Usage</TableHead>
              <TableHead className="whitespace-nowrap min-w-[90px]">Sisa</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="whitespace-nowrap min-w-[180px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
          {filtered.length === 0 ? (
            <TableEmpty colSpan={8} message={search ? "No keys match your search" : "No API keys created yet"} />
          ) : (
            filtered.map((key) => {
              const effectiveQuota = getEffectiveQuota(key);
              const displayed = showFullKey === key.id ? fullKey(key) : key.key_prefix;
              return (
              <TableRow key={key.id}>
                <TableCell className="font-medium text-text-primary align-top py-4">
                  {editingNameId === key.buyer_id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        className="h-8 w-36 rounded border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
                        autoFocus
                      />
                      <Button size="sm" onClick={updateBuyerName} loading={editNameLoading}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditingNameId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={buyerNameClassName(key.buyer_name, key.quota_tokens)}>{key.buyer_name}</span>
                      {isSuperAdminName(key.buyer_name) ? <SuperAdminBadge /> : null}
                      {isSupporterName(key.buyer_name) ? <SupporterBadge /> : null}
                      {isHelperName(key.buyer_name) ? <HelperBadge /> : null}
                      {!isSuperAdminName(key.buyer_name) && !isSupporterName(key.buyer_name) && !isHelperName(key.buyer_name) && isUltraQuota(key.quota_tokens) ? <UltraBadge /> : null}
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
                <TableCell className="align-top py-4">
                  <div className="flex items-center gap-1.5">
                    <code className="text-xs bg-surface-tertiary px-2 py-1 rounded-md font-mono max-w-[200px] truncate" title={displayed}>
                      {displayed}
                    </code>
                    <button
                      onClick={() => setShowFullKey(showFullKey === key.id ? null : key.id)}
                      className="text-text-muted hover:text-text-primary transition-colors shrink-0"
                      title={showFullKey === key.id ? "Hide full key" : "Show full key"}
                    >
                      {showFullKey === key.id ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <CopyButton text={fullKey(key)} />
                  </div>
                </TableCell>
                <TableCell className="align-top py-4 tabular-nums">{Number(key.used_requests).toLocaleString()}</TableCell>
                <TableCell className="align-top py-4">
                  {key.rate_limit_rpm ? (
                    <span className="text-text-primary font-medium tabular-nums">{key.rate_limit_rpm}</span>
                  ) : (
                    <span className="text-text-muted italic">default</span>
                  )}
                </TableCell>
                <TableCell className="align-top py-4">
                  <div className="space-y-1.5 min-w-[160px]">
                    <div className="text-sm">
                      <span className="tabular-nums">{formatTokens(key.used_tokens)}</span>
                      <span className="text-text-muted mx-1">/</span>
                      <span className="tabular-nums">
                        {effectiveQuota ? formatTokens(effectiveQuota) : "unlimited"}
                      </span>
                      {key.daily_reset && <span className="text-sky-400 text-xs ml-1">/day</span>}
                    </div>
                    {effectiveQuota && (() => {
                      const pct = Math.min(100, (Number(key.used_tokens) / Number(effectiveQuota)) * 100);
                      const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-primary-500";
                      return (
                        <div className="flex items-center gap-2">
                          <div className="w-28 h-2 bg-surface-tertiary rounded-full">
                            <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-text-muted tabular-nums w-8">{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })()}
                  </div>
                </TableCell>
                <TableCell className="align-top py-4">
                  {(() => {
                    const r = formatRemaining(key.expires_at);
                    const cls =
                      r.tone === "danger" ? "text-red-400" :
                      r.tone === "warn" ? "text-yellow-400" :
                      r.tone === "ok" ? "text-emerald-400" :
                      "text-text-muted";
                    return (
                      <span className={`text-sm font-medium tabular-nums ${cls}`} title={key.expires_at || "No expiry"}>
                        {r.label}
                      </span>
                    );
                  })()}
                </TableCell>
                <TableCell className="align-top py-4">
                  <StatusBlock keyRow={key} />
                </TableCell>
                <TableCell className="align-top py-4">
                  <ActionButtons keyRow={key} compact />
                  <InlineEditor keyRow={key} />
                </TableCell>
              </TableRow>
              );
            })
          )}
          </TableBody>
        </Table>
      </div>

      <CreateKeyModal open={createOpen} onOpenChange={setCreateOpen} onSuccess={onRefresh} />
      <AddTokensModal open={addTokensOpen} onOpenChange={setAddTokensOpen} onSuccess={onRefresh} keys={keys} />
      <ExtendKeysModal open={extendKeysOpen} onOpenChange={setExtendKeysOpen} onSuccess={onRefresh} keys={keys} />
      <EditRpmModal
        open={editRpmId !== null}
        onOpenChange={(open) => { if (!open) setEditRpmId(null); }}
        keyId={editRpmId}
        currentRpm={editRpmCurrent}
        onSuccess={onRefresh}
      />
      <BulkUpdateModal open={bulkUpdateOpen} onOpenChange={setBulkUpdateOpen} onSuccess={onRefresh} />
    </div>
  );
}
