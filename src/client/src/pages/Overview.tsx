import { Users, Key, Activity, Coins, LayoutDashboard } from "lucide-react";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { Leaderboard } from "./Leaderboard";
import { formatTokens } from "../lib/utils";
import type { Overview as OverviewData, ChartPoint } from "../hooks/useDashboard";

interface OverviewProps {
  overview: OverviewData;
  chartData?: ChartPoint[];
  chartRange?: string;
  setChartRange?: (range: string) => void;
}

export function Overview({ overview }: OverviewProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<LayoutDashboard className="h-5 w-5 text-text-muted" />}
        title="Overview"
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

      {/* Leaderboard */}
      <Leaderboard />
    </div>
  );
}
