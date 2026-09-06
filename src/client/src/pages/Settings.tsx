import { useEffect, useState } from "react";
import { RefreshCw, Monitor, Smartphone, LogOut, Plus, Trash2, Edit2, Power, ListPlus, Settings as SettingsIcon } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { api } from "../lib/api";

type UpstreamApiKey = {
  id: string;
  label: string;
  apiKey: string;
  isActive: boolean;
};

type Upstream = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  apiKeys?: UpstreamApiKey[];
};

type ManagedKey = {
  id: string;
  label: string;
  apiKey: string;
  isActive: boolean;
  masked: string;
};

export function Settings() {
  const { toast } = useToast();

  const [upstreams, setUpstreams] = useState<Upstream[]>([]);
  const [loadingUpstreams, setLoadingUpstreams] = useState(true);
  // Form state for add/edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  // Multi API-key manager for selected upstream
  const [keysUpstreamId, setKeysUpstreamId] = useState<string | null>(null);
  const [managedKeys, setManagedKeys] = useState<ManagedKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkKeyValues, setBulkKeyValues] = useState("");
  const [bulkLabelPrefix, setBulkLabelPrefix] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const [sessions, setSessions] = useState<Array<{
    id: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    last_active_at: string;
    expires_at: string;
  }>>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadUpstreams(),
      api<{ sessions: typeof sessions }>("/admin/sessions").then((data) => {
        setSessions(data.sessions);
      }).catch(() => {
        setSessions([]);
      }).finally(() => setSessionsLoading(false)),
    ]).catch(() => {
      toast("Failed to load settings", "error");
    });
  }, []);

  async function loadUpstreams() {
    setLoadingUpstreams(true);
    try {
      const data = await api<{ upstreams: Upstream[] }>("/admin/upstreams");
      setUpstreams(data.upstreams);
    } catch {
      toast("Failed to load upstreams", "error");
    } finally {
      setLoadingUpstreams(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setFormName("");
    setFormBaseUrl("");
    setFormApiKey("");
  }

  function startEdit(up: Upstream) {
    setEditingId(up.id);
    setFormName(up.name);
    setFormBaseUrl(up.baseUrl);
    setFormApiKey(up.apiKey);
  }

  async function saveUpstream() {
    if (!formName.trim()) { toast("Name is required", "error"); return; }
    if (!formBaseUrl.trim()) { toast("Base URL is required", "error"); return; }
    try { new URL(formBaseUrl); } catch { toast("Invalid URL format", "error"); return; }
    if (!formApiKey.trim()) { toast("API Key is required", "error"); return; }

    setFormSaving(true);
    try {
      if (editingId) {
        await api(`/admin/upstreams/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({ name: formName, base_url: formBaseUrl, api_key: formApiKey })
        });
        toast("Upstream updated", "success");
      } else {
        await api("/admin/upstreams", {
          method: "POST",
          body: JSON.stringify({ name: formName, base_url: formBaseUrl, api_key: formApiKey, is_active: true })
        });
        toast("Upstream created and synced", "success");
      }
      resetForm();
      await loadUpstreams();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save upstream", "error");
    } finally {
      setFormSaving(false);
    }
  }

  async function toggleUpstream(id: string) {
    try {
      await api(`/admin/upstreams/${id}/toggle`, { method: "PATCH" });
      toast("Upstream toggled", "success");
      await loadUpstreams();
    } catch {
      toast("Failed to toggle upstream", "error");
    }
  }

  async function deleteUpstream(id: string) {
    if (!confirm("Delete this upstream? This cannot be undone.")) return;
    try {
      await api(`/admin/upstreams/${id}`, { method: "DELETE" });
      toast("Upstream deleted", "success");
      if (editingId === id) resetForm();
      await loadUpstreams();
    } catch {
      toast("Failed to delete upstream", "error");
    }
  }

  async function openKeysManager(upstreamId: string) {
    setKeysUpstreamId(upstreamId);
    setKeysLoading(true);
    setNewKeyValue("");
    setNewKeyLabel("");
    setBulkMode(false);
    setBulkKeyValues("");
    setBulkLabelPrefix("");
    try {
      const data = await api<{ keys: ManagedKey[] }>(`/admin/upstreams/${upstreamId}/keys`);
      setManagedKeys(data.keys || []);
    } catch {
      toast("Failed to load API keys", "error");
      setManagedKeys([]);
    } finally {
      setKeysLoading(false);
    }
  }

  async function addManagedKey() {
    if (!keysUpstreamId) return;
    if (!newKeyValue.trim()) { toast("API key is required", "error"); return; }
    setKeySaving(true);
    try {
      await api(`/admin/upstreams/${keysUpstreamId}/keys`, {
        method: "POST",
        body: JSON.stringify({ api_key: newKeyValue.trim(), label: newKeyLabel.trim() || undefined, is_active: true }),
      });
      toast("API key added (round-robin active)", "success");
      setNewKeyValue("");
      setNewKeyLabel("");
      await openKeysManager(keysUpstreamId);
      await loadUpstreams();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add API key", "error");
    } finally {
      setKeySaving(false);
    }
  }

  async function addBulkManagedKeys() {
    if (!keysUpstreamId) return;
    const keys = Array.from(new Set(bulkKeyValues.split(/\r?\n/).map((key) => key.trim()).filter(Boolean)));
    if (!keys.length) { toast("Paste at least one API key, one per line", "error"); return; }
    setBulkSaving(true);
    try {
      const result = await api<{ added: number; skipped: number; duplicateInput: number; message: string }>(`/admin/upstreams/${keysUpstreamId}/keys/bulk`, {
        method: "POST",
        body: JSON.stringify({ keys, label_prefix: bulkLabelPrefix.trim() || undefined, is_active: true }),
      });
      const duplicateNote = result.duplicateInput > 0 ? ` · ${result.duplicateInput} duplicate input` : "";
      const skippedNote = result.skipped > result.duplicateInput ? ` · ${result.skipped - result.duplicateInput} already existed` : "";
      toast(`${result.added} key added${result.added === 1 ? "" : "s"}${duplicateNote}${skippedNote}`, "success");
      setBulkKeyValues("");
      setBulkLabelPrefix("");
      await openKeysManager(keysUpstreamId);
      await loadUpstreams();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add API keys", "error");
    } finally {
      setBulkSaving(false);
    }
  }

  async function toggleManagedKey(keyId: string) {
    if (!keysUpstreamId) return;
    try {
      await api(`/admin/upstreams/${keysUpstreamId}/keys/${keyId}/toggle`, { method: "PATCH" });
      await openKeysManager(keysUpstreamId);
      await loadUpstreams();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to toggle key", "error");
    }
  }

  async function deleteManagedKey(keyId: string) {
    if (!keysUpstreamId) return;
    if (!confirm("Delete this upstream API key?")) return;
    try {
      await api(`/admin/upstreams/${keysUpstreamId}/keys/${keyId}`, { method: "DELETE" });
      toast("API key deleted", "success");
      await openKeysManager(keysUpstreamId);
      await loadUpstreams();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete key", "error");
    }
  }

  async function revokeSessionAction(sessionId: string) {
    setRevokingId(sessionId);
    try {
      await api(`/admin/sessions/${sessionId}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast("Session revoked", "success");
    } catch {
      toast("Failed to revoke session", "error");
    } finally {
      setRevokingId(null);
    }
  }

  async function revokeAllOther() {
    try {
      await api("/admin/sessions", { method: "DELETE" });
      setSessions((prev) => prev.slice(0, 1));
      toast("All other sessions revoked", "success");
    } catch {
      toast("Failed to revoke sessions", "error");
    }
  }

  function parseDevice(ua: string | null) {
    if (!ua) return { device: "Unknown", icon: <Monitor className="h-4 w-4" /> };
    const lower = ua.toLowerCase();
    if (lower.includes("android") || lower.includes("iphone") || lower.includes("ipad") || lower.includes("mobile")) {
      return { device: "Mobile", icon: <Smartphone className="h-4 w-4" /> };
    }
    return { device: "Desktop", icon: <Monitor className="h-4 w-4" /> };
  }

  function parseBrowser(ua: string | null): string {
    if (!ua) return "Unknown";
    if (ua.includes("Chrome") && !ua.includes("Edg")) return "Chrome";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
    if (ua.includes("Edg")) return "Edge";
    return "Other";
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  if (loadingUpstreams || sessionsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5 text-text-muted" />}
        title="Settings"
      />

      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle>Upstream Configuration</CardTitle>
        </CardHeader>
        <p className="text-xs text-text-muted mb-4">
          Multiple upstreams with per-model pinning + automatic failover. Each upstream supports multiple API keys with round-robin.
        </p>

        {/* Form */}
        <div className="space-y-4 mb-6 p-4 rounded-lg border border-border bg-surface-secondary">
          <h3 className="text-sm font-semibold text-text-primary">{editingId ? "Edit Upstream" : "Add New Upstream"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., Alibaba Primary" />
            <Input label="Base URL" value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-text-secondary">Primary API Key</label>
              <input
                type="password"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="sk-..."
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={saveUpstream} loading={formSaving}>
              {editingId ? "Update" : "Add Upstream"}
            </Button>
            {editingId && (
              <Button variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-left">
                <th className="pb-2 pl-2">Name</th>
                <th className="pb-2">Base URL</th>
                <th className="pb-2">Primary Key</th>
                <th className="pb-2 text-center">Keys</th>
                <th className="pb-2 text-center">Status</th>
                <th className="pb-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {upstreams.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-muted">No upstreams configured yet.</td>
                </tr>
              ) : (
                upstreams.map((up) => (
                  <tr key={up.id} className="border-b border-border/50 hover:bg-surface-secondary/50 transition-colors">
                    <td className="py-3 pl-2 font-medium text-text-primary">{up.name}</td>
                    <td className="py-3 text-text-secondary truncate max-w-[200px]" title={up.baseUrl}>{up.baseUrl}</td>
                    <td className="py-3 text-text-muted font-mono text-xs">
                      {up.apiKey ? `${up.apiKey.slice(0, 6)}...${up.apiKey.slice(-4)}` : "-"}
                    </td>
                    <td className="py-3 text-center">
                      <button
                        type="button"
                        onClick={() => openKeysManager(up.id)}
                        className="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-tertiary text-text-secondary"
                        title="Manage API keys (round-robin)"
                      >
                        {(up.apiKeys?.length ?? 1)} key{(up.apiKeys?.length ?? 1) === 1 ? "" : "s"}
                      </button>
                    </td>
                    <td className="py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${up.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${up.isActive ? "bg-green-400" : "bg-red-400"}`}></span>
                        {up.isActive ? "Active" : "Off"}
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(up)} title="Edit">
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleUpstream(up.id)} title={up.isActive ? "Disable" : "Enable"}>
                          <Power className={`h-3.5 w-3.5 ${!up.isActive ? "text-red-400" : ""}`} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteUpstream(up.id)} title="Delete" className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {keysUpstreamId && (
        <Card className="w-full max-w-4xl">
          <CardHeader>
            <CardTitle>
              API Keys — {upstreams.find((u) => u.id === keysUpstreamId)?.name || "Upstream"}
            </CardTitle>
          </CardHeader>
          <p className="text-xs text-text-muted mb-4">
            Requests to this upstream rotate across active keys (round-robin). On 429/5xx the next key is tried, then other upstreams.
          </p>

          <div className="mb-4 rounded-lg border border-border bg-surface-secondary p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={bulkMode ? "secondary" : "default"}
                onClick={() => setBulkMode(false)}
              >
                <Plus className="h-3.5 w-3.5" /> Single key
              </Button>
              <Button
                size="sm"
                variant={bulkMode ? "default" : "secondary"}
                onClick={() => setBulkMode(true)}
              >
                <ListPlus className="h-3.5 w-3.5" /> Bulk paste
              </Button>
              <span className="text-xs text-text-muted">Maksimal 1.000 key · satu key per baris</span>
            </div>

            {bulkMode ? (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium text-text-secondary">API Keys</label>
                  <textarea
                    value={bulkKeyValues}
                    onChange={(e) => setBulkKeyValues(e.target.value)}
                    placeholder={'Paste banyak key di sini, satu per baris\\nsk-...\\nsk-...\\nsk-...'}
                    rows={6}
                    className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                  <p className="text-xs text-text-muted">Baris kosong dan key duplikat di input akan dilewati. Key yang sudah ada juga tidak menggagalkan batch.</p>
                </div>
                <Input
                  label="Label prefix (optional)"
                  value={bulkLabelPrefix}
                  onChange={(e) => setBulkLabelPrefix(e.target.value)}
                  placeholder="e.g. qwen → qwen-1, qwen-2"
                />
                <div className="flex gap-2">
                  <Button onClick={addBulkManagedKeys} loading={bulkSaving}>
                    <ListPlus className="h-3.5 w-3.5" /> Add All Keys
                  </Button>
                  <Button variant="secondary" onClick={() => { setBulkMode(false); setBulkKeyValues(""); setBulkLabelPrefix(""); }}>
                    Clear
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input
                  label="Label (optional)"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="e.g. key-2"
                />
                <div className="grid gap-1.5 md:col-span-2">
                  <label className="text-sm font-medium text-text-secondary">New API Key</label>
                  <input
                    type="password"
                    value={newKeyValue}
                    onChange={(e) => setNewKeyValue(e.target.value)}
                    placeholder="sk-..."
                    className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
                  />
                </div>
                <div className="md:col-span-3">
                  <Button onClick={addManagedKey} loading={keySaving}>Add Key</Button>
                </div>
              </div>
            )}
          </div>
          <div className="mb-4">
            <Button variant="secondary" onClick={() => { setKeysUpstreamId(null); setManagedKeys([]); }}>Close key manager</Button>
          </div>

          {keysLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          ) : managedKeys.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">No keys yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-text-muted text-left">
                    <th className="pb-2 pl-2">Label</th>
                    <th className="pb-2">Key</th>
                    <th className="pb-2 text-center">Status</th>
                    <th className="pb-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {managedKeys.map((k) => (
                    <tr key={k.id} className="border-b border-border/50">
                      <td className="py-3 pl-2 text-text-primary">{k.label || "(no label)"}</td>
                      <td className="py-3 font-mono text-xs text-text-muted">{k.masked}</td>
                      <td className="py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${k.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                          {k.isActive ? "Active" : "Off"}
                        </span>
                      </td>
                      <td className="py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => toggleManagedKey(k.id)} title={k.isActive ? "Disable" : "Enable"}>
                            <Power className={`h-3.5 w-3.5 ${!k.isActive ? "text-red-400" : ""}`} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteManagedKey(k.id)} title="Delete" className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Active Sessions */}
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Active Sessions
          </CardTitle>
        </CardHeader>
        {sessionsLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">No active sessions</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session, index) => {
              const { device, icon } = parseDevice(session.user_agent);
              const browser = parseBrowser(session.user_agent);
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-secondary"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface-tertiary">
                      {icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {browser} on {device}
                        </span>
                        {index === 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-500 font-medium">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
                        <span>{session.ip_address || "Unknown IP"}</span>
                        <span>·</span>
                        <span>{timeAgo(session.last_active_at)}</span>
                      </div>
                    </div>
                  </div>
                  {index !== 0 && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => revokeSessionAction(session.id)}
                      loading={revokingId === session.id}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
            {sessions.length > 1 && (
              <div className="pt-2">
                <Button variant="secondary" size="sm" onClick={revokeAllOther}>
                  Revoke All Other Sessions
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
