import { useEffect, useState } from "react";
import { 
  Trophy, Key, Cpu, Zap, Calendar, Gauge, Clock, Activity, 
  CheckCircle2, AlertCircle, Coins, Layers, ArrowUpRight 
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/Dialog";
import { CopyButton } from "./CopyButton";
import { SuperAdminBadge } from "./SuperAdminBadge";
import { SupporterBadge } from "./SupporterBadge";
import { HelperBadge } from "./HelperBadge";
import { UltraBadge } from "./UltraBadge";
import { ProBadge } from "./ProBadge";
import { api } from "../lib/api";
import { 
  formatTokens, formatNumber, formatDateShort, buyerNameClassName,
  isSuperAdminName, isSupporterName, isHelperName, isUltraKey, isProKey 
} from "../lib/utils";

type TelemetryData = {
  key: {
    id: string;
    label: string;
    key_prefix: string;
    buyer_id: string;
    buyer_name: string;
    buyer_email: string;
    package_id: string | null;
    is_ultra?: boolean;
    access_roles?: string[];
    rate_limit_rpm: number | null;
    created_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    remaining_days: number | null;
    daily_reset: boolean;
    daily_quota_tokens: number | null;
    quota_tokens: number | null;
    quota_requests: number | null;
    used_tokens: number;
    used_requests: number;
  };
  totals: {
    requests: number;
    ok_requests: number;
    tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_latency_ms: number | null;
    first_request_at: string | null;
    last_request_at: string | null;
    today_requests: number;
    today_tokens: number;
  };
  models: {
    model_id: string;
    display_name: string;
    requests: number;
    tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_latency_ms: number | null;
    last_request_at: string | null;
  }[];
  recent: {
    created_at: string;
    model_id: string;
    display_name: string;
    status_code: number;
    success: boolean;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    latency_ms: number;
  }[];
};

interface UserDetailModalProps {
  keyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function planLabel(roles?: string[] | null, isUltra?: boolean, quotaTokens?: number | null, name?: string | null): string {
  if (isSuperAdminName(name, roles)) return "KING";
  if (isSupporterName(name, roles)) return "Supporter";
  if (isHelperName(name, roles)) return "Helper";
  if (isUltraKey(isUltra, quotaTokens, roles)) return "Ultra";
  if (isProKey(roles)) return "Pro";
  return "Starter";
}

export function UserDetailModal({ keyId, open, onOpenChange }: UserDetailModalProps) {
  const [data, setData] = useState<TelemetryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !keyId) {
      setData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    api<TelemetryData>(`/admin/keys/${keyId}/telemetry`)
      .then((res) => {
        if (isMounted) setData(res);
      })
      .catch((err) => {
        if (isMounted) setError(err.message || "Failed to load telemetry");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, keyId]);

  const k = data?.key;
  const tot = data?.totals;
  const models = data?.models ?? [];
  const recent = data?.recent ?? [];

  const quota = k?.daily_reset && k?.daily_quota_tokens != null ? k.daily_quota_tokens : k?.quota_tokens;
  const used = Number(k?.used_tokens || 0);
  const isUnlimited = quota == null || Number(quota) <= 0;
  const quotaPct = !isUnlimited && Number(quota) > 0 ? Math.min(100, Math.round((used / Number(quota)) * 100)) : 0;
  const quotaBarColor = quotaPct >= 90 ? "bg-red-500" : quotaPct >= 75 ? "bg-amber-500" : "bg-sky-500";

  const isPaused = !!k?.revoked_at;
  const expiryText = k?.revoked_at ? "Paused" : (k?.expires_at == null ? "No expiry ∞" : `${k.remaining_days ?? 0}d left`);
  const rpmText = k?.rate_limit_rpm == null ? "Default RPM" : `${k.rate_limit_rpm} RPM`;

  const totalUserTokens = tot?.tokens || 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-5 sm:p-7 bg-surface border-border text-text-primary rounded-2xl shadow-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle>
            <div className="text-xl font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary-500" />
              User Telemetry &amp; Account Details
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-16 text-center text-text-muted space-y-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto"></div>
            <p className="text-sm">Loading user account telemetry...</p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-80" />
            <p className="font-semibold text-sm">{error}</p>
          </div>
        ) : !data ? null : (
          <div className="space-y-6">
            {/* 1. Identity Hero Banner */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-r from-surface-tertiary via-surface to-surface-tertiary p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-primary-500/15 border border-primary-500/30 flex items-center justify-center shrink-0">
                    <Trophy className="h-6 w-6 text-primary-400" />
                  </div>
                  <div>
                    <div className="flex items-center flex-wrap gap-2">
                      <span className={`text-lg font-bold tracking-tight ${buyerNameClassName(k?.buyer_name, k?.quota_tokens, k?.is_ultra, k?.access_roles)}`}>
                        {k?.buyer_name || "Unknown User"}
                      </span>
                      {isSuperAdminName(k?.buyer_name, k?.access_roles) ? <SuperAdminBadge /> : null}
                      {isSupporterName(k?.buyer_name, k?.access_roles) ? <SupporterBadge /> : null}
                      {isHelperName(k?.buyer_name, k?.access_roles) ? <HelperBadge /> : null}
                      {!isSuperAdminName(k?.buyer_name, k?.access_roles) &&
                       !isSupporterName(k?.buyer_name, k?.access_roles) &&
                       !isHelperName(k?.buyer_name, k?.access_roles) &&
                       isUltraKey(k?.is_ultra, k?.quota_tokens, k?.access_roles) ? <UltraBadge /> : null}
                      {isProKey(k?.access_roles) ? <ProBadge /> : null}
                    </div>
                    <div className="flex items-center flex-wrap gap-2 text-xs text-text-muted mt-1">
                      <span className="inline-flex items-center gap-1 font-mono bg-surface-secondary px-2 py-0.5 rounded border border-border/80">
                        {k?.key_prefix}****
                        <CopyButton text={k?.key_prefix || ""} />
                      </span>
                      <span>•</span>
                      <span className={`font-medium ${isSuperAdminName(k?.buyer_name, k?.access_roles) ? "text-red-500 font-semibold dark:text-red-400" : "text-text-secondary"}`}>{planLabel(k?.access_roles, k?.is_ultra, k?.quota_tokens, k?.buyer_name)} Plan</span>
                      <span>•</span>
                      <span>{rpmText}</span>
                      <span>•</span>
                      <span className="text-text-muted">{k?.buyer_email}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    isPaused ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`} />
                    {isPaused ? "Paused" : "Active"}
                  </span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-secondary border border-border text-text-secondary">
                    {expiryText}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Bento Grid Telemetry */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* Card A: Token Quota & Capacity */}
              <div className="p-4 rounded-xl border border-border bg-surface-tertiary/60 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs text-text-muted mb-2">
                    <span className="flex items-center gap-1.5 font-medium text-text-secondary">
                      <Coins className="h-3.5 w-3.5 text-yellow-400" />
                      Token Quota
                    </span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border font-semibold">
                      {isUnlimited ? "Unlimited ∞" : `${quotaPct}% used`}
                    </span>
                  </div>
                  <div className="text-xl font-bold tracking-tight text-text-primary">
                    {isUnlimited ? (
                      <span>Unlimited</span>
                    ) : (
                      <span>{formatTokens(used)} <span className="text-sm font-normal text-text-muted">/ {formatTokens(quota || 0)}</span></span>
                    )}
                  </div>
                  {!isUnlimited && (
                    <div className="w-full bg-surface-secondary h-2 rounded-full mt-2.5 overflow-hidden border border-border/50">
                      <div className={`h-full ${quotaBarColor} transition-all duration-300`} style={{ width: `${quotaPct}%` }} />
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-text-muted mt-3">
                  {k?.daily_reset ? "Daily quota resets at 00:00 WIB" : "Total package balance"}
                </div>
              </div>

              {/* Card B: Lifetime Traffic Metrics */}
              <div className="p-4 rounded-xl border border-border bg-surface-tertiary/60 md:col-span-2">
                <div className="flex items-center justify-between text-xs text-text-muted mb-3">
                  <span className="flex items-center gap-1.5 font-medium text-text-secondary">
                    <Zap className="h-3.5 w-3.5 text-sky-400" />
                    Lifetime Traffic
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {tot?.avg_latency_ms != null ? `Avg Latency: ${tot.avg_latency_ms}ms` : ""}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2 rounded-lg bg-surface/70 border border-border/60">
                    <div className="text-[11px] text-text-muted">Requests</div>
                    <div className="text-base font-bold text-text-primary mt-0.5">
                      {tot?.requests.toLocaleString("id-ID") ?? 0}
                    </div>
                    <div className="text-[10px] text-emerald-400 mt-0.5">
                      {tot?.requests ? Math.round(((tot.ok_requests ?? 0) / tot.requests) * 100) : 100}% OK
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-surface/70 border border-border/60">
                    <div className="text-[11px] text-text-muted">Total Tokens</div>
                    <div className="text-base font-bold text-text-primary mt-0.5">
                      {formatTokens(tot?.tokens ?? 0)}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">All models</div>
                  </div>

                  <div className="p-2 rounded-lg bg-surface/70 border border-border/60">
                    <div className="text-[11px] text-text-muted">Prompt</div>
                    <div className="text-base font-bold text-text-primary mt-0.5">
                      {formatTokens(tot?.prompt_tokens ?? 0)}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {tot?.tokens ? Math.round((tot.prompt_tokens / tot.tokens) * 100) : 0}% of total
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-surface/70 border border-border/60">
                    <div className="text-[11px] text-text-muted">Today (WIB)</div>
                    <div className="text-base font-bold text-sky-400 mt-0.5">
                      {formatTokens(tot?.today_tokens ?? 0)}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {tot?.today_requests.toLocaleString("id-ID") ?? 0} reqs today
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Usage per Model */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                  <Cpu className="h-4 w-4 text-purple-400" />
                  Usage per Model ({models.length})
                </h4>
              </div>

              {models.length === 0 ? (
                <div className="p-6 text-center rounded-xl border border-border bg-surface-tertiary/40 text-xs text-text-muted">
                  No model usage recorded yet
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-surface-tertiary/40">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/80 text-text-muted font-medium bg-surface/50">
                        <th className="text-left p-2.5">Model</th>
                        <th className="text-right p-2.5">Requests</th>
                        <th className="text-right p-2.5">Tokens</th>
                        <th className="text-left p-2.5 w-28 sm:w-36 hidden sm:table-cell">Share</th>
                        <th className="text-right p-2.5 hidden md:table-cell">Last Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {models.map((m) => {
                        const sharePct = Math.min(100, Math.round((m.tokens / totalUserTokens) * 100));
                        return (
                          <tr key={m.model_id} className="hover:bg-surface-secondary/60 transition-colors">
                            <td className="p-2.5">
                              <div className="font-semibold text-text-primary">{m.display_name}</div>
                              <div className="text-[10px] text-text-muted font-mono">{m.model_id}</div>
                            </td>
                            <td className="p-2.5 text-right font-medium text-text-primary">
                              {m.requests.toLocaleString("id-ID")}
                            </td>
                            <td className="p-2.5 text-right font-bold text-text-primary">
                              {formatTokens(m.tokens)}
                            </td>
                            <td className="p-2.5 hidden sm:table-cell">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-surface-secondary h-1.5 rounded-full overflow-hidden border border-border/40">
                                  <div className="h-full bg-purple-500 rounded-full" style={{ width: `${sharePct}%` }} />
                                </div>
                                <span className="text-[10px] text-text-muted font-mono w-7 text-right">{sharePct}%</span>
                              </div>
                            </td>
                            <td className="p-2.5 text-right text-text-muted hidden md:table-cell">
                              {timeAgo(m.last_request_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 4. Recent Requests */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-emerald-400" />
                  Recent Activity (Last {recent.length})
                </h4>
              </div>

              {recent.length === 0 ? (
                <div className="p-6 text-center rounded-xl border border-border bg-surface-tertiary/40 text-xs text-text-muted">
                  No recent activity logged
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-surface-tertiary/40 max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface z-10">
                      <tr className="border-b border-border/80 text-text-muted font-medium">
                        <th className="text-left p-2.5">Time</th>
                        <th className="text-left p-2.5">Model</th>
                        <th className="text-center p-2.5 w-16">Status</th>
                        <th className="text-right p-2.5">Tokens</th>
                        <th className="text-right p-2.5 w-20">Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {recent.map((ev, idx) => {
                        const is200 = ev.success || ev.status_code === 200;
                        const latMs = ev.latency_ms || 0;
                        const latCls = latMs < 1000 ? "text-emerald-400" : latMs < 3000 ? "text-amber-400" : "text-red-400";
                        return (
                          <tr key={idx} className="hover:bg-surface-secondary/60 transition-colors">
                            <td className="p-2.5 text-text-muted whitespace-nowrap" title={formatDateShort(ev.created_at)}>
                              {timeAgo(ev.created_at)}
                            </td>
                            <td className="p-2.5 font-medium text-text-primary whitespace-nowrap">
                              {ev.display_name || ev.model_id}
                            </td>
                            <td className="p-2.5 text-center">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                is200 ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-red-500/15 text-red-400 border border-red-500/30"
                              }`}>
                                {ev.status_code || 200}
                              </span>
                            </td>
                            <td className="p-2.5 text-right font-semibold text-text-primary whitespace-nowrap">
                              {formatTokens(ev.total_tokens)}
                            </td>
                            <td className={`p-2.5 text-right font-mono text-[11px] ${latCls} whitespace-nowrap`}>
                              {latMs ? `${latMs}ms` : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
