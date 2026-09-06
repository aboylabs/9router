import { useState, useEffect, useCallback } from "react";
import { Radio, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { CopyButton } from "../components/CopyButton";
import { api } from "../lib/api";
import { SuperAdminBadge } from "../components/SuperAdminBadge";
import { SupporterBadge } from "../components/SupporterBadge";
import { HelperBadge } from "../components/HelperBadge";
import { UltraBadge } from "../components/UltraBadge";
import {
  formatDateShort,
  formatTokens,
  isSuperAdminName,
  isSupporterName,
  isHelperName,
  isUltraKey
} from "../lib/utils";

type LiveEntry = {
  key_prefix: string;
  key_id: string;
  buyer_name: string;
  buyer_email: string;
  quota_tokens?: string | null;
  is_ultra?: boolean;
  access_roles?: string[] | null;
  request_count: number;
  last_request_at: string;
  total_tokens: string;
  ip_count?: number;
  ips?: string[] | null;
  models_used: string[] | null;
};

function ipCountLabel(count?: number) {
  const n = Number(count) || 0;
  return n === 1 ? "1 IP" : `${n} IPs`;
}

function ipBadgeVariant(count?: number): "success" | "warning" | "danger" | "info" {
  const n = Number(count) || 0;
  if (n >= 5) return "danger";
  if (n >= 3) return "warning";
  if (n >= 1) return "success";
  return "info";
}

export function Live() {
  const [active, setActive] = useState<LiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchLive = useCallback(async () => {
    try {
      const data = await api<{ active: LiveEntry[] }>("/admin/live");
      setActive(data.active);
      setLastRefresh(new Date());
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchLive]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Radio className="h-5 w-5 text-text-muted" />}
        title="Live"
        subtitle="Active keys · last 5 minutes"
        actions={
          <>
            <span className="text-xs text-text-muted">
              Updated: {lastRefresh.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false })}
            </span>
            <Button variant="outline" size="sm" onClick={fetchLive} title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-text-primary">{active.length}</div>
            <div className="text-xs text-text-muted mt-1">Active Keys</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {active.reduce((sum, a) => sum + a.request_count, 0)}
            </div>
            <div className="text-xs text-text-muted mt-1">Requests (5min)</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {formatTokens(active.reduce((sum, a) => sum + Number(a.total_tokens), 0))}
            </div>
            <div className="text-xs text-text-muted mt-1">Tokens (5min)</div>
          </div>
        </Card>
      </div>

      {/* Active users */}
      {loading ? (
        <p className="text-sm text-text-muted text-center py-8">Loading...</p>
      ) : active.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-text-muted text-sm">No active users in the last 5 minutes</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((entry) => (
            <Card key={entry.key_id}>
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <span className="font-medium text-sm truncate text-text-primary">
                      {entry.buyer_name}
                    </span>
                    {isSuperAdminName(entry.buyer_name, entry.access_roles) ? <SuperAdminBadge /> : null}
                    {isSupporterName(entry.buyer_name, entry.access_roles) ? <SupporterBadge /> : null}
                    {isHelperName(entry.buyer_name, entry.access_roles) ? <HelperBadge /> : null}
                    {!isSuperAdminName(entry.buyer_name, entry.access_roles) && !isSupporterName(entry.buyer_name, entry.access_roles) && !isHelperName(entry.buyer_name, entry.access_roles) && isUltraKey(entry.is_ultra, entry.quota_tokens, entry.access_roles) ? <UltraBadge /> : null}
                  </div>
                  <Badge variant="info">{entry.request_count} req</Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>{entry.buyer_email}</span>
                  <div className="flex items-center gap-1">
                    <code className="bg-surface-tertiary px-1.5 py-0.5 rounded font-mono text-text-muted">{entry.key_prefix}****</code>
                    <CopyButton text={entry.key_prefix} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">Tokens: <span className="text-text-primary font-medium">{formatTokens(entry.total_tokens)}</span></span>
                  <span className="text-text-muted">Last: {formatDateShort(entry.last_request_at)}</span>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs pt-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-text-muted shrink-0">IPs (5m)</span>
                    <Badge variant={ipBadgeVariant(entry.ip_count)}>{ipCountLabel(entry.ip_count)}</Badge>
                  </div>
                  {entry.ips && entry.ips.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1 min-w-0">
                      {entry.ips.map((ip) => (
                        <code key={ip} className="bg-surface-tertiary px-1.5 py-0.5 rounded font-mono text-text-muted" title={ip}>
                          {ip}
                        </code>
                      ))}
                    </div>
                  ) : (
                    <span className="text-text-muted">no IP yet</span>
                  )}
                </div>
                {entry.models_used && entry.models_used.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {entry.models_used.map((model) => (
                      <span key={model} className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded text-text-muted">
                        {model.replace("routers9/", "")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
