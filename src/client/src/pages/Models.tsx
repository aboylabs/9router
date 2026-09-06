import { useMemo, useState } from "react";
import { Infinity as InfinityIcon, Power, Search, ShieldCheck, Trash2, Box } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/PageHeader";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { useToast } from "../components/ui/Toast";
import { ModelAccessModal } from "../components/ModelAccessModal";
import { api } from "../lib/api";
import type { Model, ModelAccessRole } from "../hooks/useDashboard";

interface ModelsPageProps {
  models: Model[];
  onRefresh: () => void;
}

const ROLE_META: Record<ModelAccessRole, { label: string }> = {
  dev: { label: "Dev" },
  supporter: { label: "Supporter" },
  ultra: { label: "Ultra" },
  pro: { label: "Pro" },
};

const ALL_ROLES: ModelAccessRole[] = ["dev", "supporter", "ultra", "pro"];

function modelPath(id: string) {
  // Keep slashes so Fastify wildcard `/admin/models/*` captures full branded id.
  return `/admin/models/${id.split("/").map(encodeURIComponent).join("/")}`;
}

function rolesOf(model: Model): ModelAccessRole[] {
  const raw = Array.isArray(model.access_roles) ? model.access_roles : [];
  const normalized = ALL_ROLES.filter((r) => raw.map(String).map((x) => x.toLowerCase()).includes(r));
  if (!normalized.length && model.privileged_only) return ["dev", "supporter"];
  return normalized;
}

function roleBadges(roles: ModelAccessRole[]) {
  if (!roles.length) return <span className="text-xs text-text-muted">All keys</span>;
  const order: ModelAccessRole[] = ["pro", "ultra", "supporter", "dev"];
  const picked = order.find((r) => roles.includes(r)) ?? roles[0];
  const extra = roles.length > 1 ? "+" : "";
  const variant = picked === "ultra" ? "success" : picked === "supporter" ? "warning" : "info";
  return (
    <span title={roles.map((r) => ROLE_META[r].label).join(", ")}>
      <Badge variant={variant}>
        {ROLE_META[picked].label}{extra}
      </Badge>
    </span>
  );
}

export function Models({ models, onRefresh }: ModelsPageProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [accessModel, setAccessModel] = useState<Model | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(needle) ||
        m.display_name.toLowerCase().includes(needle) ||
        (m.upstream_model || "").toLowerCase().includes(needle)
    );
  }, [models, q]);

  async function patchModel(
    model: Model,
    body: Partial<Pick<Model, "active" | "quota_exempt" | "display_name" | "access_roles">>
  ) {
    setBusyId(model.id);
    try {
      await api(modelPath(model.id), {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (body.access_roles !== undefined) {
        const roles = body.access_roles as ModelAccessRole[];
        toast(
          roles.length
            ? `${model.display_name}: ${roles.map((r) => ROLE_META[r].label).join(" · ")} only`
            : `${model.display_name}: open to all keys`
        );
      } else if (body.quota_exempt !== undefined) {
        toast(body.quota_exempt ? `${model.display_name}: Free/Unlimited ON` : `${model.display_name}: Free/Unlimited OFF`);
      } else if (body.active !== undefined) {
        toast(body.active ? `${model.display_name}: Active` : `${model.display_name}: Inactive`);
      } else {
        toast("Model updated");
      }
      onRefresh();
    } catch (err: any) {
      toast(err?.message || "Failed to update model", "error");
    } finally {
      setBusyId(null);
    }
  }

  function openAccess(model: Model) {
    setAccessModel(model);
    setAccessOpen(true);
  }

  async function saveAccessRoles(model: Model, roles: ModelAccessRole[]) {
    await patchModel(model, { access_roles: roles });
  }

  async function deleteModel(model: Model) {
    const ok = window.confirm(
      `Hapus model "${model.display_name}" (${model.id})?\n\n` +
        `• buyer_model_access ikut terhapus (CASCADE)\n` +
        `• history usage tetap (model_id tersimpan sebagai teks)\n` +
        `• tidak bisa di-undo kecuali sync/add lagi`
    );
    if (!ok) return;

    setBusyId(model.id);
    try {
      const result = await api<{ access_removed?: number }>(modelPath(model.id), { method: "DELETE" });
      toast(`Deleted ${model.id}${result.access_removed ? ` (access removed: ${result.access_removed})` : ""}`);
      onRefresh();
    } catch (err: any) {
      toast(err?.message || "Failed to delete model", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Box className="h-5 w-5 text-text-muted" />}
        title="Models"
        subtitle={`${filtered.length} models · Access sets who can call each one`}
      />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search model id / name..."
          className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      {/* Mobile card view */}
      <div className="lg:hidden space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">
            {models.length === 0 ? "No models configured. Sync models." : "No models match search."}
          </p>
        ) : (
          filtered.map((model) => {
            const busy = busyId === model.id;
            const roles = rolesOf(model);
            return (
              <div key={model.id} className="border border-border rounded-lg p-3 space-y-2 bg-surface">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono break-all">{model.id}</code>
                  <div className="flex items-center gap-1 shrink-0">
                    {model.quota_exempt && <Badge variant="info">Free</Badge>}
                    <Badge variant={model.active ? "success" : "default"}>{model.active ? "Active" : "Off"}</Badge>
                  </div>
                </div>
                <div className="text-sm font-medium text-text-primary">{model.display_name}</div>
                {model.upstream_name && (
                  <div className="text-xs text-text-muted">
                    via <span className="font-medium text-text-secondary">{model.upstream_name}</span>
                  </div>
                )}
                <div>{roleBadges(roles)}</div>
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    title="Atur role yang boleh akses model ini"
                    onClick={() => openAccess(model)}
                  >
                    <ShieldCheck className={`h-3.5 w-3.5 ${roles.length ? "text-accent" : ""}`} />
                    Access
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    title={model.quota_exempt ? "Disable Free/Unlimited" : "Enable Free/Unlimited"}
                    onClick={() => patchModel(model, { quota_exempt: !model.quota_exempt })}
                  >
                    <InfinityIcon className={`h-3.5 w-3.5 ${model.quota_exempt ? "text-sky-500" : ""}`} />
                    Free
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    title={model.active ? "Deactivate" : "Activate"}
                    onClick={() => patchModel(model, { active: !model.active })}
                  >
                    <Power className={`h-3.5 w-3.5 ${!model.active ? "text-red-400" : ""}`} />
                    {model.active ? "On" : "Off"}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} title="Delete model" onClick={() => deleteModel(model)}>
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>
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
                <TableHead className="whitespace-nowrap">Model ID</TableHead>
                <TableHead className="whitespace-nowrap">Display Name</TableHead>
                <TableHead className="whitespace-nowrap">Upstream</TableHead>
                <TableHead className="whitespace-nowrap">Access Roles</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableEmpty
                  colSpan={6}
                  message={models.length === 0 ? "No models configured. Sync models." : "No models match search."}
                />
              ) : (
                filtered.map((model) => {
                  const busy = busyId === model.id;
                  const roles = rolesOf(model);
                  return (
                    <TableRow key={model.id}>
                      <TableCell>
                        <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono">{model.id}</code>
                      </TableCell>
                      <TableCell className="font-medium text-text-primary">{model.display_name}</TableCell>
                      <TableCell>
                        {model.upstream_name ? (
                          <span title={model.upstream_id || undefined}>
                            <Badge variant="default">{model.upstream_name}</Badge>
                          </span>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell>{roleBadges(roles)}</TableCell>
                      <TableCell>
                        <Badge variant={model.active ? "success" : "default"}>{model.active ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            title="Atur role yang boleh akses model ini"
                            onClick={() => openAccess(model)}
                          >
                            <ShieldCheck className={`h-3.5 w-3.5 ${roles.length ? "text-accent" : ""}`} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            title={model.quota_exempt ? "Disable Free/Unlimited (metered again)" : "Enable Free/Unlimited for this model"}
                            onClick={() => patchModel(model, { quota_exempt: !model.quota_exempt })}
                          >
                            <InfinityIcon className={`h-3.5 w-3.5 ${model.quota_exempt ? "text-sky-500" : ""}`} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            title={model.active ? "Deactivate model" : "Activate model"}
                            onClick={() => patchModel(model, { active: !model.active })}
                          >
                            <Power className={`h-3.5 w-3.5 ${!model.active ? "text-red-400" : ""}`} />
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            title="Delete model"
                            onClick={() => deleteModel(model)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Showing {filtered.length} of {models.length} models. Tombol Access (perisai) untuk atur role Dev / Supporter / Ultra —
          kosong = semua key. Restricted models stay visible on public panel with role badges.
        </p>
      </div>

      <ModelAccessModal
        open={accessOpen}
        onOpenChange={setAccessOpen}
        model={accessModel}
        saving={accessModel !== null && busyId === accessModel.id}
        onSave={saveAccessRoles}
      />
    </div>
  );
}
