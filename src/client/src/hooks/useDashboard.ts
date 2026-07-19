import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

export type Buyer = {
  id: string;
  name: string;
  email?: string;
  notes?: string;
  used_tokens: string;
  total_quota: string;
  request_count: string;
  key_count: number;
  api_keys: string[];
  created_at: string;
};

export type Model = {
  id: string;
  upstream_model: string;
  display_name: string;
  active: boolean;
  input_cost_per_million?: string;
  output_cost_per_million?: string;
};

export type Key = {
  id: string;
  buyer_id: string;
  buyer_name: string;
  buyer_email?: string;
  label: string;
  key_prefix: string;
  key_plain?: string;
  expires_at: string | null;
  revoked_at: string | null;
  quota_tokens: string | null;
  quota_requests: string | null;
  used_tokens: string;
  used_requests: string;
  created_at: string;
  daily_reset: boolean;
  daily_quota_tokens: string | null;
  package_id: string | null;
  rate_limit_rpm: number | null;
  is_vip: boolean;
};

export type UsageEvent = {
  created_at: string;
  buyer_name: string | null;
  key_prefix: string | null;
  agent_id: string;
  model_id: string | null;
  status_code: number;
  total_tokens: string;
  latency_ms: number;
  success: boolean;
  estimated: boolean;
  cost_estimate?: string;
};

export type ChartPoint = {
  label: string;
  requests: number;
  tokens: number;
};

export type Overview = {
  buyers: number;
  activeKeys: number;
  totalKeys: number;
  requests: number;
  tokens: number;
  costEstimate: number;
};

export function useDashboard() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [usage, setUsage] = useState<UsageEvent[]>([]);
  const [overview, setOverview] = useState<Overview>({ buyers: 0, activeKeys: 0, totalKeys: 0, requests: 0, tokens: 0, costEstimate: 0 });
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [chartRange, setChartRange] = useState<string>("7d");
  const [loading, setLoading] = useState(true);

  const refreshChart = useCallback(async (range: string) => {
    try {
      const data = await api<{ points: ChartPoint[] }>(`/admin/usage/chart?range=${range}`);
      setChartData(data.points);
    } catch (err) {
      console.error("Failed to refresh chart data:", err);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [overviewData, buyerData, modelData, keyData, usageData] = await Promise.all([
        api<Overview>("/admin/overview"),
        api<{ buyers: Buyer[] }>("/admin/buyers"),
        api<{ models: Model[] }>("/admin/models"),
        api<{ keys: Key[] }>("/admin/keys"),
        api<{ events: UsageEvent[] }>("/admin/usage")
      ]);
      setOverview(overviewData);
      setBuyers(buyerData.buyers);
      setModels(modelData.models);
      setKeys(keyData.keys);
      setUsage(usageData.events);
      await refreshChart(chartRange);
    } catch (err) {
      console.error("Failed to refresh dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [chartRange, refreshChart]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const activeModels = models.filter((m) => m.active);

  return { buyers, models, activeModels, keys, usage, overview, chartData, chartRange, setChartRange, refreshChart, loading, refresh };
}
