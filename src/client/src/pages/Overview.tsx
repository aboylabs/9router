import { Users, Key, Activity, Coins, LayoutDashboard } from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Leaderboard } from "./Leaderboard";
import { formatNumber, formatTokens } from "../lib/utils";
import type { Overview as OverviewData, ChartPoint } from "../hooks/useDashboard";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface OverviewProps {
  overview: OverviewData;
  chartData: ChartPoint[];
  chartRange: string;
  setChartRange: (range: string) => void;
}

const RANGE_OPTIONS = [
  { value: "15m", label: "15 Min" },
  { value: "1h", label: "1 Hour" },
  { value: "6h", label: "6 Hours" },
  { value: "12h", label: "12 Hours" },
  { value: "1d", label: "1 Day" },
  { value: "3d", label: "3 Days" },
  { value: "7d", label: "7 Days" },
  { value: "1M", label: "1 Month" },
];

export function Overview({ overview, chartData, chartRange, setChartRange }: OverviewProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<LayoutDashboard className="h-5 w-5 text-primary-500" />}
        title="Dashboard"
        subtitle="Overview of your API gateway"
      />

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <MetricCard
          label="Total API Keys"
          value={overview.totalKeys ?? overview.activeKeys}
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

      {/* Leaderboard */}
      <Leaderboard />
    </div>
  );
}
