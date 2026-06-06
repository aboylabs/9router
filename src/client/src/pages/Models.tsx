import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../components/ui/Toast";
import { api } from "../lib/api";
import type { Model } from "../hooks/useDashboard";

interface ModelsPageProps {
  models: Model[];
  onRefresh: () => void;
}

export function Models({ models, onRefresh }: ModelsPageProps) {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  async function syncModels() {
    setSyncing(true);
    try {
      const result = await api<{ synced: number }>("/admin/models/sync", { method: "POST" });
      toast(`Synced ${result.synced} models`);
      onRefresh();
    } catch {
      toast("Model sync failed. Check provider config.", "error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Model Catalog</h2>
          <p className="text-sm text-text-muted">Manage available AI models</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={syncModels} loading={syncing}>
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Sync Models</span>
          </Button>
        </div>
      </div>

      {/* Mobile card view */}
      <div className="lg:hidden space-y-3">
        {models.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">No models configured. Sync models.</p>
        ) : (
          models.map((model) => (
            <div key={model.id} className="border border-border rounded-lg p-3 space-y-2 bg-surface">
              <div className="flex items-center justify-between">
                <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono">{model.id}</code>
                <Badge variant={model.active ? "success" : "default"}>
                  {model.active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="text-sm font-medium text-text-primary">{model.display_name}</div>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>In: {model.input_cost_per_million ? `$${model.input_cost_per_million}/1M` : "-"}</span>
                <span>Out: {model.output_cost_per_million ? `$${model.output_cost_per_million}/1M` : "-"}</span>
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
                <TableHead className="whitespace-nowrap">Model ID</TableHead>
                <TableHead className="whitespace-nowrap">Display Name</TableHead>
                <TableHead className="whitespace-nowrap">Input Cost</TableHead>
                <TableHead className="whitespace-nowrap">Output Cost</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
          {models.length === 0 ? (
            <TableEmpty colSpan={5} message="No models configured. Sync models." />
          ) : (
            models.map((model) => (
              <TableRow key={model.id}>
                <TableCell>
                  <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono">{model.id}</code>
                </TableCell>
                <TableCell className="font-medium text-text-primary">{model.display_name}</TableCell>
                <TableCell>{model.input_cost_per_million ? `$${model.input_cost_per_million}` : "-"}</TableCell>
                <TableCell>{model.output_cost_per_million ? `$${model.output_cost_per_million}` : "-"}</TableCell>
                <TableCell>
                  <Badge variant={model.active ? "success" : "default"}>
                    {model.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
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
