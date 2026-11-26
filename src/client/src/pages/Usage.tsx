import { useState } from "react";
import { Search, Activity } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { CopyButton } from "../components/CopyButton";
import {
  formatDateShort,
  formatNumber,
  buyerNameClassName,
  isSuperAdminName,
  isSupporterName,
  isHelperName,
  isUltraKey,
  roleRowClassName
} from "../lib/utils";
import type { UsageEvent } from "../hooks/useDashboard";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { SuperAdminBadge } from "../components/SuperAdminBadge";
import { SupporterBadge } from "../components/SupporterBadge";
import { HelperBadge } from "../components/HelperBadge";
import { UltraBadge } from "../components/UltraBadge";

interface UsagePageProps {
  usage: UsageEvent[];
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export function Usage({ usage }: UsagePageProps) {
  const [search, setSearch] = useState("");

  const filtered = usage.filter((event) => {
    const q = search.toLowerCase();
    return (
      (event.buyer_name?.toLowerCase().includes(q) ?? false) ||
      (event.key_prefix?.toLowerCase().includes(q) ?? false) ||
      (event.model_id?.toLowerCase().includes(q) ?? false)
    );
  });

  // Usage by model for pie chart
  const modelUsage = buildModelUsage(usage);

  // Hourly usage for area chart (last 24h)
  const hourlyData = buildHourlyData(usage);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Activity className="h-5 w-5 text-text-muted" />}
        title="Usage"
        subtitle="Last 250 requests"
      />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Tokens (Last 24h)</CardTitle>
          </CardHeader>
          {hourlyData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <AreaChart data={hourlyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px"
                    }}
                  />
                  <Area type="monotone" dataKey="tokens" stroke="#3b82f6" strokeWidth={2} fill="url(#usageGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-text-muted py-8 text-center">No data</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage by Model</CardTitle>
          </CardHeader>
          {modelUsage.length > 0 ? (
            <div className="h-48 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                  <Pie
                    data={modelUsage}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    dataKey="tokens"
                    nameKey="model"
                    label={({ name }) => String(name ?? "")}
                  >
                    {modelUsage.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px"
                    }}
                    formatter={(value) => [formatNumber(Number(value ?? 0)) + " tokens"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-text-muted py-8 text-center">No data</p>
          )}
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search by buyer, key, or model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
        />
      </div>

      {/* Mobile card view */}
      <div className="lg:hidden space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">{search ? "No events match your search" : "No usage events yet"}</p>
        ) : (
          filtered.map((event, i) => (
            <div key={i} className={`border border-border rounded-lg p-3 space-y-1.5 bg-surface${roleRowClassName(event.buyer_name, event.quota_tokens, event.is_ultra) ? " " + roleRowClassName(event.buyer_name, event.quota_tokens, event.is_ultra) : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{formatDateShort(event.created_at)}</span>
                {event.success ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-500"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{event.status_code}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-red-500"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{event.status_code}</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded">{event.model_id?.split("/").pop() || "-"}</code>
                <span className="text-xs font-medium text-text-primary">{formatNumber(event.total_tokens)} tok{event.estimated && <span className="text-text-muted ml-1">est.</span>}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-text-muted gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`truncate font-medium ${buyerNameClassName(event.buyer_name, event.quota_tokens, event.is_ultra, event.access_roles)}`}>
                    {event.buyer_name || "-"}
                  </span>
                  {isSuperAdminName(event.buyer_name, event.access_roles) ? <SuperAdminBadge /> : null}
                  {isSupporterName(event.buyer_name, event.access_roles) ? <SupporterBadge /> : null}
                  {isHelperName(event.buyer_name, event.access_roles) ? <HelperBadge /> : null}
                  {!isSuperAdminName(event.buyer_name, event.access_roles) && !isSupporterName(event.buyer_name, event.access_roles) && !isHelperName(event.buyer_name, event.access_roles) && isUltraKey(event.is_ultra, event.quota_tokens, event.access_roles) ? <UltraBadge /> : null}
                </div>
                <span className="shrink-0">{event.latency_ms}ms</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop table view */}
      <div className="hidden lg:block">
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Time</TableHead>
                <TableHead className="whitespace-nowrap">Buyer</TableHead>
                <TableHead className="whitespace-nowrap">Key</TableHead>
                <TableHead className="whitespace-nowrap">Model</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap">Tokens</TableHead>
                <TableHead className="whitespace-nowrap">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
          {filtered.length === 0 ? (
            <TableEmpty colSpan={7} message={search ? "No events match your search" : "No usage events yet"} />
          ) : (
            filtered.map((event, i) => (
              <TableRow key={i}>
                <TableCell>{formatDateShort(event.created_at)}</TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    <span className={buyerNameClassName(event.buyer_name, event.quota_tokens, event.is_ultra, event.access_roles)}>
                      {event.buyer_name || "-"}
                    </span>
                    {isSuperAdminName(event.buyer_name, event.access_roles) ? <SuperAdminBadge /> : null}
                    {isSupporterName(event.buyer_name, event.access_roles) ? <SupporterBadge /> : null}
                    {isHelperName(event.buyer_name, event.access_roles) ? <HelperBadge /> : null}
                    {!isSuperAdminName(event.buyer_name, event.access_roles) && !isSupporterName(event.buyer_name, event.access_roles) && !isHelperName(event.buyer_name, event.access_roles) && isUltraKey(event.is_ultra, event.quota_tokens, event.access_roles) ? <UltraBadge /> : null}
                  </div>
                </TableCell>
                <TableCell>
                  {event.key_prefix ? (
                    <div className="flex items-center gap-1">
                      <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono">{event.key_prefix}</code>
                      <CopyButton text={event.key_prefix} />
                    </div>
                  ) : (
                    <span className="text-text-muted">-</span>
                  )}
                </TableCell>
                <TableCell>{event.model_id || "-"}</TableCell>
                <TableCell>
                  <Badge variant={event.success ? "success" : "danger"}>
                    {event.status_code}
                  </Badge>
                </TableCell>
                <TableCell>
                  {formatNumber(event.total_tokens)}
                  {event.estimated && <span className="text-text-muted text-xs ml-1">est.</span>}
                </TableCell>
                <TableCell>{event.latency_ms}ms</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function buildModelUsage(usage: UsageEvent[]) {
  const map = new Map<string, number>();
  for (const event of usage) {
    const model = event.model_id || "unknown";
    map.set(model, (map.get(model) || 0) + Number(event.total_tokens));
  }
  return Array.from(map.entries())
    .map(([model, tokens]) => ({ model: model.split("/").pop() || model, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);
}

function buildHourlyData(usage: UsageEvent[]) {
  const now = new Date();
  const hours = new Map<string, number>();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", hour12: false });
    hours.set(key, 0);
  }

  for (const event of usage) {
    const d = new Date(event.created_at);
    const key = d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", hour12: false });
    if (hours.has(key)) {
      hours.set(key, (hours.get(key) || 0) + Number(event.total_tokens));
    }
  }

  return Array.from(hours.entries()).map(([hour, tokens]) => ({ hour, tokens }));
}
