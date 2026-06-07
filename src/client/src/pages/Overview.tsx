import { Users, Key, Activity, Coins } from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { formatDateShort, formatNumber, formatTokens } from "../lib/utils";
import type { Overview as OverviewData, ChartPoint, Key as KeyType } from "../hooks/useDashboard";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface OverviewProps {
  overview: OverviewData;
  chartData: ChartPoint[];
  chartRange: string;
  setChartRange: (range: string) => void;
  keys: KeyType[];
}

const RANGE_OPTIONS = [
  { value: "15m", label: "15 Min" },
  { value: "1h", label: "1 Jam" },
  { value: "6h", label: "6 Jam" },
  { value: "12h", label: "12 Jam" },
  { value: "1d", label: "1 Hari" },
  { value: "3d", label: "3 Hari" },
  { value: "7d", label: "7 Hari" },
  { value: "1M", label: "1 Bulan" },
];

export function Overview({ overview, chartData, chartRange, setChartRange, keys }: OverviewProps) {
  // Recent keys (last 5)
  const recentKeys = keys.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Dashboard</h2>
        <p className="text-sm text-text-muted">Overview of your API gateway</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <MetricCard
          label="Buyers"
          value={overview.buyers}
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          label="Active Keys"
          value={overview.activeKeys}
          icon={<Key className="h-4 w-4" />}
        />
        <MetricCard
          label="Requests"
          value={overview.requests}
          icon={<Activity className="h-4 w-4" />}
        />
        <MetricCard
          label="Tokens Used"
          value={formatTokens(overview.tokens)}
          icon={<Coins className="h-4 w-4" />}
        />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle>Total Request & Tokens</CardTitle>
            <select
              value={chartRange}
              onChange={(e) => setChartRange(e.target.value)}
              className="text-sm bg-surface-tertiary border border-border rounded-md px-3 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 w-full sm:w-auto"
            >
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        {chartData.length > 0 ? (
          <div className="h-48 sm:h-64 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="requestGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatNumber(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatTokens(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    fontSize: "12px"
                  }}
                  formatter={(value, name) => {
                    if (name === "requests") return [formatNumber(Number(value ?? 0)) + " req", "Requests"];
                    if (name === "tokens") return [formatTokens(Number(value ?? 0)), "Tokens"];
                    return [value, name];
                  }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="requests"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#requestGradient)"
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="tokens"
                  stroke="#eab308"
                  strokeWidth={2}
                  fill="url(#tokenGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-text-muted py-8 text-center">No usage data yet</p>
        )}
      </Card>

      {/* Recent Keys */}
      <Card>
        <CardHeader>
          <CardTitle>Recent API Keys</CardTitle>
        </CardHeader>

        {/* Mobile card view */}
        <div className="lg:hidden space-y-3 p-4 pt-0">
          {recentKeys.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">No keys created yet</p>
          ) : (
            recentKeys.map((key) => {
              const pct = key.quota_tokens ? Math.min(100, (Number(key.used_tokens) / Number(key.quota_tokens)) * 100) : 0;
              const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-primary-500";
              return (
                <div key={key.id} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary text-sm">{key.buyer_name}</span>
                    {key.revoked_at ? (
                      <Badge variant="danger">Revoked</Badge>
                    ) : key.expires_at && new Date(key.expires_at) < new Date() ? (
                      <Badge variant="warning">Expired</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </div>
                  <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded">{key.key_prefix}</code>
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{formatTokens(key.used_tokens)} / {key.quota_tokens ? formatTokens(key.quota_tokens) : "unlimited"}</span>
                    <span>{formatDateShort(key.expires_at)}</span>
                  </div>
                  {key.quota_tokens && (
                    <div className="w-full h-1.5 bg-surface-tertiary rounded-full">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table view */}
        <div className="hidden lg:block">
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Buyer</TableHead>
                  <TableHead className="whitespace-nowrap">Prefix</TableHead>
                  <TableHead className="whitespace-nowrap">Usage</TableHead>
                  <TableHead className="whitespace-nowrap">Expiry</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
            {recentKeys.length === 0 ? (
              <TableEmpty colSpan={5} message="No keys created yet" />
            ) : (
              recentKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium text-text-primary">{key.buyer_name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded">{key.key_prefix}</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{formatTokens(key.used_tokens)}</span>
                      <span className="text-text-muted">/</span>
                      <span>{key.quota_tokens ? formatTokens(key.quota_tokens) : "unlimited"}</span>
                    </div>
                    {key.quota_tokens && (() => {
                      const pct = Math.min(100, (Number(key.used_tokens) / Number(key.quota_tokens)) * 100);
                      const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-primary-500";
                      return (
                        <div className="w-24 h-1.5 bg-surface-tertiary rounded-full mt-1">
                          <div
                            className={`h-full ${color} rounded-full transition-all`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      );
                    })()}</TableCell>
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
                </TableRow>
              ))
            )}
          </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    </div>
  );
}
