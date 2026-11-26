import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  Trophy, ArrowUp, ArrowDown, RefreshCw, Cpu, User, ArrowUpRight, 
  Flame, Sparkles, Star, Zap, Heart, Shield
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/CopyButton";
import { UserDetailModal } from "../components/UserDetailModal";
import { api } from "../lib/api";
import { SuperAdminBadge } from "../components/SuperAdminBadge";
import { SupporterBadge } from "../components/SupporterBadge";
import { HelperBadge } from "../components/HelperBadge";
import { UltraBadge } from "../components/UltraBadge";
import { ProBadge } from "../components/ProBadge";
import { 
  formatDateShort, formatLastActive, formatDateMY, formatTokens, buyerNameClassName,
  isSuperAdminName, isSupporterName, isHelperName, isUltraKey, isProKey 
} from "../lib/utils";

type LeaderboardEntry = {
  buyer_id: string;
  buyer_name: string;
  buyer_email: string;
  key_id: string;
  key_label: string;
  key_prefix: string;
  expires_at: string | null;
  key_created_at: string;
  total_requests: number;
  total_tokens: string;
  prompt_tokens: string;
  completion_tokens: string;
  last_request_at: string;
  quota_tokens?: string | null;
  is_ultra?: boolean;
  access_roles?: string[] | null;
};

type RoleSummary = {
  role: "supporter" | "ultra" | "pro" | "free" | "dev";
  total_requests: number;
  total_tokens: string | number;
  top_model_name: string;
  top_model_id: string;
  top_model_requests: number;
  top_model_tokens: string | number;
  top_user_name: string;
  top_user_key_prefix: string;
  top_user_key_id: string;
  top_user_requests: number;
  top_user_tokens: string | number;
};

function formatRemainingDays(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry ∞";
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return "Expired";
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

function getExpiryColor(expiresAt: string | null): string {
  if (!expiresAt) return "text-purple-400";
  const expiry = new Date(expiresAt);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs <= 0) return "text-red-500";
  const days = diffMs / (1000 * 60 * 60 * 24);
  if (days <= 3) return "text-orange-500";
  if (days <= 7) return "text-yellow-500";
  return "text-green-500";
}

function getEntryRole(entry: LeaderboardEntry): "dev" | "supporter" | "ultra" | "pro" | "free" {
  if (isSuperAdminName(entry.buyer_name, entry.access_roles)) return "dev";
  if (isSupporterName(entry.buyer_name, entry.access_roles)) return "supporter";
  if (isUltraKey(entry.is_ultra, entry.quota_tokens, entry.access_roles)) return "ultra";
  if (isProKey(entry.access_roles)) return "pro";
  return "free";
}

type SortKey = "total_requests" | "total_tokens" | "last_request_at";
type SortDir = "asc" | "desc";
type RoleFilter = "all" | "supporter" | "ultra" | "pro" | "free";

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [roleSummaries, setRoleSummaries] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("total_requests");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await api<{ rows: LeaderboardEntry[]; role_summaries?: RoleSummary[] }>("/admin/leaderboard");
      setEntries(data.rows || []);
      if (data.role_summaries) {
        setRoleSummaries(data.role_summaries);
      }
      setLastRefresh(new Date());
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const filteredEntries = useMemo(() => {
    if (roleFilter === "all") return entries;
    return entries.filter((e) => getEntryRole(e) === roleFilter);
  }, [entries, roleFilter]);

  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      let valA: number | string = a[sortKey];
      let valB: number | string = b[sortKey];

      if (sortKey === "total_tokens") {
        valA = Number(a.total_tokens);
        valB = Number(b.total_tokens);
      }

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredEntries, sortKey, sortDir]);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUp className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // Get summary by role
  const getSummary = (role: "supporter" | "ultra" | "pro" | "free") => {
    return roleSummaries.find((s) => s.role === role);
  };

  const supporterSum = getSummary("supporter");
  const ultraSum = getSummary("ultra");
  const proSum = getSummary("pro");
  const freeSum = getSummary("free");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-text-primary flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Leaderboard
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Klik nama user untuk melihat detail akun &amp; telemetri
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted hidden sm:block">
            Updated: {lastRefresh.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false })}
          </span>
          <Button variant="outline" size="sm" onClick={fetchLeaderboard} title="Refresh leaderboard">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Role Summaries: Top Model & Top User per Role */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* 1. Supporter */}
        <div className="p-4 rounded-xl border border-yellow-500/25 bg-gradient-to-b from-yellow-500/10 via-surface to-surface flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                <Heart className="h-3 w-3 fill-current" />
                Supporter
              </span>
              <span className="text-[11px] font-mono text-yellow-400 font-semibold">
                {supporterSum ? formatTokens(supporterSum.total_tokens) : "-"}
              </span>
            </div>

            <div className="space-y-2 mt-3 text-xs">
              <div className="p-2 rounded-lg bg-surface-secondary/70 border border-border/60">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-yellow-400" />
                  Top Model
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate" title={supporterSum?.top_model_name}>
                  {supporterSum?.top_model_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {supporterSum ? `${supporterSum.top_model_requests.toLocaleString("id-ID")} req · ${formatTokens(supporterSum.top_model_tokens)}` : "-"}
                </div>
              </div>

              <div 
                className={`p-2 rounded-lg bg-surface-secondary/70 border border-border/60 ${supporterSum?.top_user_key_id ? "cursor-pointer hover:border-yellow-500/50 hover:bg-yellow-500/5 transition-colors group" : ""}`}
                onClick={() => supporterSum?.top_user_key_id && setSelectedKeyId(supporterSum.top_user_key_id)}
                title={supporterSum?.top_user_key_id ? "Klik untuk lihat detail user" : ""}
              >
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3 text-yellow-400" />
                    Top User
                  </span>
                  {supporterSum?.top_user_key_id && (
                    <ArrowUpRight className="h-3 w-3 text-text-muted group-hover:text-yellow-400 transition-colors" />
                  )}
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate group-hover:text-yellow-300 transition-colors">
                  {supporterSum?.top_user_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {supporterSum ? `${supporterSum.top_user_key_prefix} · ${formatTokens(supporterSum.top_user_tokens)}` : "-"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Ultra */}
        <div className="p-4 rounded-xl border border-cyan-500/25 bg-gradient-to-b from-cyan-500/10 via-surface to-surface flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                <Zap className="h-3 w-3 fill-current" />
                Ultra
              </span>
              <span className="text-[11px] font-mono text-cyan-400 font-semibold">
                {ultraSum ? formatTokens(ultraSum.total_tokens) : "-"}
              </span>
            </div>

            <div className="space-y-2 mt-3 text-xs">
              <div className="p-2 rounded-lg bg-surface-secondary/70 border border-border/60">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-cyan-400" />
                  Top Model
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate" title={ultraSum?.top_model_name}>
                  {ultraSum?.top_model_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {ultraSum ? `${ultraSum.top_model_requests.toLocaleString("id-ID")} req · ${formatTokens(ultraSum.top_model_tokens)}` : "-"}
                </div>
              </div>

              <div 
                className={`p-2 rounded-lg bg-surface-secondary/70 border border-border/60 ${ultraSum?.top_user_key_id ? "cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-colors group" : ""}`}
                onClick={() => ultraSum?.top_user_key_id && setSelectedKeyId(ultraSum.top_user_key_id)}
                title={ultraSum?.top_user_key_id ? "Klik untuk lihat detail user" : ""}
              >
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3 text-cyan-400" />
                    Top User
                  </span>
                  {ultraSum?.top_user_key_id && (
                    <ArrowUpRight className="h-3 w-3 text-text-muted group-hover:text-cyan-400 transition-colors" />
                  )}
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate group-hover:text-cyan-300 transition-colors">
                  {ultraSum?.top_user_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {ultraSum ? `${ultraSum.top_user_key_prefix} · ${formatTokens(ultraSum.top_user_tokens)}` : "-"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Pro */}
        <div className="p-4 rounded-xl border border-blue-500/25 bg-gradient-to-b from-blue-500/10 via-surface to-surface flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                <Star className="h-3 w-3 fill-current" />
                Pro
              </span>
              <span className="text-[11px] font-mono text-blue-400 font-semibold">
                {proSum ? formatTokens(proSum.total_tokens) : "-"}
              </span>
            </div>

            <div className="space-y-2 mt-3 text-xs">
              <div className="p-2 rounded-lg bg-surface-secondary/70 border border-border/60">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-blue-400" />
                  Top Model
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate" title={proSum?.top_model_name}>
                  {proSum?.top_model_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {proSum ? `${proSum.top_model_requests.toLocaleString("id-ID")} req · ${formatTokens(proSum.top_model_tokens)}` : "-"}
                </div>
              </div>

              <div 
                className={`p-2 rounded-lg bg-surface-secondary/70 border border-border/60 ${proSum?.top_user_key_id ? "cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors group" : ""}`}
                onClick={() => proSum?.top_user_key_id && setSelectedKeyId(proSum.top_user_key_id)}
                title={proSum?.top_user_key_id ? "Klik untuk lihat detail user" : ""}
              >
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3 text-blue-400" />
                    Top User
                  </span>
                  {proSum?.top_user_key_id && (
                    <ArrowUpRight className="h-3 w-3 text-text-muted group-hover:text-blue-400 transition-colors" />
                  )}
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate group-hover:text-blue-300 transition-colors">
                  {proSum?.top_user_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {proSum ? `${proSum.top_user_key_prefix} · ${formatTokens(proSum.top_user_tokens)}` : "-"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4. Free / Starter */}
        <div className="p-4 rounded-xl border border-border bg-gradient-to-b from-surface-tertiary via-surface to-surface flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold bg-surface-secondary text-text-secondary border border-border">
                <Shield className="h-3 w-3" />
                Free / Starter
              </span>
              <span className="text-[11px] font-mono text-text-secondary font-semibold">
                {freeSum ? formatTokens(freeSum.total_tokens) : "-"}
              </span>
            </div>

            <div className="space-y-2 mt-3 text-xs">
              <div className="p-2 rounded-lg bg-surface-secondary/70 border border-border/60">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-text-secondary" />
                  Top Model
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate" title={freeSum?.top_model_name}>
                  {freeSum?.top_model_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {freeSum ? `${freeSum.top_model_requests.toLocaleString("id-ID")} req · ${formatTokens(freeSum.top_model_tokens)}` : "-"}
                </div>
              </div>

              <div 
                className={`p-2 rounded-lg bg-surface-secondary/70 border border-border/60 ${freeSum?.top_user_key_id ? "cursor-pointer hover:border-primary-500/50 hover:bg-primary-500/5 transition-colors group" : ""}`}
                onClick={() => freeSum?.top_user_key_id && setSelectedKeyId(freeSum.top_user_key_id)}
                title={freeSum?.top_user_key_id ? "Klik untuk lihat detail user" : ""}
              >
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3 text-text-secondary" />
                    Top User
                  </span>
                  {freeSum?.top_user_key_id && (
                    <ArrowUpRight className="h-3 w-3 text-text-muted group-hover:text-primary-400 transition-colors" />
                  )}
                </div>
                <div className="font-semibold text-text-primary mt-0.5 truncate group-hover:text-primary-300 transition-colors">
                  {freeSum?.top_user_name || "None"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {freeSum ? `${freeSum.top_user_key_prefix} · ${formatTokens(freeSum.top_user_tokens)}` : "-"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Role Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-border/60 text-xs">
        <button
          onClick={() => setRoleFilter("all")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            roleFilter === "all"
              ? "bg-primary-500/15 text-primary-300 border border-primary-500/30"
              : "text-text-muted hover:text-text-primary hover:bg-surface-tertiary"
          }`}
        >
          Semua ({entries.length})
        </button>
        <button
          onClick={() => setRoleFilter("supporter")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 ${
            roleFilter === "supporter"
              ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40"
              : "text-text-muted hover:text-text-primary hover:bg-surface-tertiary"
          }`}
        >
          <Heart className="h-3 w-3 fill-current text-yellow-400" />
          Supporter
        </button>
        <button
          onClick={() => setRoleFilter("ultra")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 ${
            roleFilter === "ultra"
              ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
              : "text-text-muted hover:text-text-primary hover:bg-surface-tertiary"
          }`}
        >
          <Zap className="h-3 w-3 fill-current text-cyan-400" />
          Ultra
        </button>
        <button
          onClick={() => setRoleFilter("pro")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 ${
            roleFilter === "pro"
              ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
              : "text-text-muted hover:text-text-primary hover:bg-surface-tertiary"
          }`}
        >
          <Star className="h-3 w-3 fill-current text-blue-400" />
          Pro
        </button>
        <button
          onClick={() => setRoleFilter("free")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 ${
            roleFilter === "free"
              ? "bg-surface-secondary text-text-primary border border-border"
              : "text-text-muted hover:text-text-primary hover:bg-surface-tertiary"
          }`}
        >
          <Shield className="h-3 w-3 text-text-muted" />
          Free
        </button>
      </div>

      {/* Main Leaderboard Table */}
      {loading ? (
        <p className="text-sm text-text-muted text-center py-8">Loading...</p>
      ) : sortedEntries.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-text-muted text-sm">Tidak ada data untuk filter ini</p>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-2.5 font-medium text-text-muted w-8">#</th>
                  <th className="text-left p-2.5 font-medium text-text-muted">Key / Buyer</th>
                  <th 
                    className="text-right p-2.5 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors"
                    onClick={() => handleSort("total_requests")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Requests <SortIcon column="total_requests" />
                    </div>
                  </th>
                  <th 
                    className="text-right p-2.5 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors hidden sm:table-cell"
                    onClick={() => handleSort("total_tokens")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Tokens <SortIcon column="total_tokens" />
                    </div>
                  </th>
                  <th 
                    className="text-right p-2.5 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors hidden md:table-cell"
                    onClick={() => handleSort("last_request_at")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Last Active <SortIcon column="last_request_at" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry, index) => (
                  <tr key={entry.key_id} className="border-b border-border hover:bg-surface-tertiary/50 transition-colors">
                    <td className="p-2.5">
                      {index === 0 && <Trophy className="h-4 w-4 text-yellow-500 inline mr-1" />}
                      {index === 1 && <Trophy className="h-4 w-4 text-gray-400 inline mr-1" />}
                      {index === 2 && <Trophy className="h-4 w-4 text-amber-700 inline mr-1" />}
                      {index > 2 && <span className="text-text-muted ml-5">{index + 1}</span>}
                    </td>
                    <td className="p-2.5">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <code className="bg-surface-tertiary px-1.5 py-0.5 rounded font-mono text-text-muted text-xs">{entry.key_prefix}****</code>
                          <CopyButton text={entry.key_prefix} />
                        </div>
                        <div className="flex items-center flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedKeyId(entry.key_id)}
                            className={`font-medium hover:text-primary-400 hover:underline underline-offset-2 transition-colors inline-flex items-center gap-1 group text-left cursor-pointer ${buyerNameClassName(entry.buyer_name, entry.quota_tokens, entry.is_ultra, entry.access_roles)}`}
                            title="Klik untuk lihat telemetri akun user"
                          >
                            <span>{entry.buyer_name}</span>
                            <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all text-primary-400" />
                          </button>
                          {isSuperAdminName(entry.buyer_name, entry.access_roles) ? <SuperAdminBadge /> : null}
                          {isSupporterName(entry.buyer_name, entry.access_roles) ? <SupporterBadge /> : null}
                          {isHelperName(entry.buyer_name, entry.access_roles) ? <HelperBadge /> : null}
                          {!isSuperAdminName(entry.buyer_name, entry.access_roles) && 
                           !isSupporterName(entry.buyer_name, entry.access_roles) && 
                           !isHelperName(entry.buyer_name, entry.access_roles) && 
                           isUltraKey(entry.is_ultra, entry.quota_tokens, entry.access_roles) ? <UltraBadge /> : null}
                          {isProKey(entry.access_roles) ? <ProBadge /> : null}
                        </div>
                        <span className="text-xs text-text-muted">{entry.buyer_email}</span>
                        <span className={`text-xs font-medium ${getExpiryColor(entry.expires_at)}`}>
                          {formatRemainingDays(entry.expires_at)}
                        </span>
                      </div>
                    </td>
                    <td className="p-2.5 text-right">
                      <span className="font-semibold text-text-primary">{entry.total_requests.toLocaleString("id-ID")}</span>
                    </td>
                    <td className="p-2.5 text-right hidden sm:table-cell">
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-text-primary">{formatTokens(entry.total_tokens)}</span>
                        <span className="text-[10px] text-text-muted">
                          P: {formatTokens(entry.prompt_tokens)} | C: {formatTokens(entry.completion_tokens)}
                        </span>
                      </div>
                    </td>
                    <td className="p-2.5 text-right text-text-muted hidden md:table-cell" title={formatDateMY(entry.last_request_at)}>
                      {formatLastActive(entry.last_request_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* User Telemetry Detail Modal */}
      <UserDetailModal
        keyId={selectedKeyId}
        open={!!selectedKeyId}
        onOpenChange={(open) => !open && setSelectedKeyId(null)}
      />
    </div>
  );
}
