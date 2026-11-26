import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export type ModelAccessRole = "dev" | "supporter" | "ultra" | "pro";

export type Model = {
  id: string;
  upstream_model: string;
  display_name: string;
  active: boolean;
  input_cost_per_million?: string;
  output_cost_per_million?: string;
  /** When true: usage is logged but does not consume key token quota. */
  quota_exempt?: boolean;
  /** Legacy: true when access_roles is non-empty. */
  privileged_only?: boolean;
  /** Independent role allowlist. Empty = all keys. */
  access_roles?: ModelAccessRole[] | string[];
  /** Upstream UUID this model is pinned to. */
  upstream_id?: string | null;
  /** Upstream display name (joined from upstreams). */
  upstream_name?: string | null;
};

export type Key = {
  id: string;
  buyer_id: string;
  buyer_name: string;
  buyer_email?: string;
  label: string;
  key_prefix: string;
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
  is_ultra?: boolean;
  access_roles?: ModelAccessRole[] | string[];
};

export type UsageEvent = {
  created_at: string;
  buyer_name: string | null;
  key_prefix: string | null;
  quota_tokens?: string | null;
  is_ultra?: boolean;
  access_roles?: string[] | null;
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
  const [models, setModels] = useState<Model[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [usage, setUsage] = useState<UsageEvent[]>([]);
  const [overview, setOverview] = useState<Overview>({ buyers: 0, activeKeys: 0, totalKeys: 0, requests: 0, tokens: 0, costEstimate: 0 });
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [chartRange, setChartRange] = useState<string>("7d");
  const [loading, setLoading] = useState(true);
  const pauseRef = useRef(false);

  const refreshChart = useCallback(async (range: string) => {
    try {
      const data = await api<{ points: ChartPoint[] }>(`/admin/usage/chart?range=${range}`);
      setChartData(data.points);
    } catch (err) {
      console.error("Failed to refresh chart data:", err);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (pauseRef.current) return;
    try {
      const [overviewData, modelData, keyData, usageData] = await Promise.all([
        api<Overview>("/admin/overview"),
        api<{ models: Model[] }>("/admin/models"),
        api<{ keys: Key[] }>("/admin/keys"),
        api<{ events: UsageEvent[] }>("/admin/usage")
      ]);
      setOverview(overviewData);
      setModels(modelData.models);
      setKeys(keyData.keys);
      setUsage(usageData.events);
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

  const setPaused = useCallback((paused: boolean) => {
    pauseRef.current = paused;
  }, []);

  return { models, keys, usage, overview, chartData, chartRange, setChartRange, refreshChart, loading, refresh, setPaused };
}
