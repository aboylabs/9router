import { useState, useEffect, useCallback } from "react";
import { Trophy, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { CopyButton } from "../components/CopyButton";
import { api } from "../lib/api";
import { formatDateShort, formatTokens } from "../lib/utils";

type LeaderboardEntry = {
  buyer_id: string;
  buyer_name: string;
  buyer_email: string;
  key_id: string;
  key_label: string;
  key_prefix: string;
  total_requests: number;
  total_tokens: string;
  prompt_tokens: string;
  completion_tokens: string;
  last_request_at: string;
};

type SortKey = "total_requests" | "total_tokens" | "last_request_at";
type SortDir = "asc" | "desc";

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("total_requests");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await api<{ rows: LeaderboardEntry[] }>("/admin/leaderboard");
      setEntries(data.rows);
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

  const sortedEntries = [...entries].sort((a, b) => {
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

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUp className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Leaderboard
          </h2>
          <p className="text-sm text-text-muted">Top API keys by request count and token usage</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted hidden sm:block">
            Updated: {lastRefresh.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false })}
          </span>
          <Button variant="outline" size="sm" onClick={fetchLeaderboard}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-text-primary">{entries.length}</div>
            <div className="text-xs text-text-muted mt-1">Active Keys</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {entries.reduce((sum, e) => sum + e.total_requests, 0).toLocaleString("id-ID")}
            </div>
            <div className="text-xs text-text-muted mt-1">Total Requests</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {formatTokens(entries.reduce((sum, e) => sum + Number(e.total_tokens), 0))}
            </div>
            <div className="text-xs text-text-muted mt-1">Total Tokens</div>
          </div>
        </Card>
        <Card>
          <div className="p-4 text-center">
            <div className="text-2xl font-bold text-text-primary">
              {new Set(entries.map(e => e.buyer_id)).size}
            </div>
            <div className="text-xs text-text-muted mt-1">Unique Buyers</div>
          </div>
        </Card>
      </div>

      {/* Leaderboard Table */}
      {loading ? (
        <p className="text-sm text-text-muted text-center py-8">Loading...</p>
      ) : sortedEntries.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-text-muted text-sm">No usage data available yet</p>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 font-medium text-text-muted">#</th>
                  <th className="text-left p-3 font-medium text-text-muted">Key / Buyer</th>
                  <th 
                    className="text-right p-3 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors"
                    onClick={() => handleSort("total_requests")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Requests <SortIcon column="total_requests" />
                    </div>
                  </th>
                  <th 
                    className="text-right p-3 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors hidden sm:table-cell"
                    onClick={() => handleSort("total_tokens")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Tokens <SortIcon column="total_tokens" />
                    </div>
                  </th>
                  <th 
                    className="text-right p-3 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors hidden md:table-cell"
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
                    <td className="p-3">
                      {index === 0 && <Trophy className="h-4 w-4 text-yellow-500 inline mr-1" />}
                      {index === 1 && <Trophy className="h-4 w-4 text-gray-400 inline mr-1" />}
                      {index === 2 && <Trophy className="h-4 w-4 text-amber-700 inline mr-1" />}
                      {index > 2 && <span className="text-text-muted ml-5">{index + 1}</span>}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <code className="bg-surface-tertiary px-1.5 py-0.5 rounded font-mono text-text-muted text-xs">{entry.key_prefix}****</code>
                          <CopyButton text={entry.key_prefix} />
                          {entry.key_label && entry.key_label !== "Hidden Key" && (
                            <Badge variant="info" className="text-[10px]">{entry.key_label}</Badge>
                          )}
                        </div>
                        <span className="text-text-primary font-medium">{entry.buyer_name}</span>
                        <span className="text-xs text-text-muted">{entry.buyer_email}</span>
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <span className="font-semibold text-text-primary">{entry.total_requests.toLocaleString("id-ID")}</span>
                    </td>
                    <td className="p-3 text-right hidden sm:table-cell">
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-text-primary">{formatTokens(entry.total_tokens)}</span>
                        <span className="text-[10px] text-text-muted">
                          P: {formatTokens(entry.prompt_tokens)} | C: {formatTokens(entry.completion_tokens)}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-right text-text-muted hidden md:table-cell">
                      {formatDateShort(entry.last_request_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
