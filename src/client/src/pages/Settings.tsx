import { useEffect, useState } from "react";
import { Eye, EyeOff, RefreshCw, User, Lock, Monitor, Smartphone, LogOut, Plus, Trash2, Edit2, Power } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { api } from "../lib/api";

type Upstream = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  weight: number;
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
  const [formWeight, setFormWeight] = useState(1);
  const [formSaving, setFormSaving] = useState(false);

  const [adminEmail, setAdminEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

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
      api<{ admin: { id: string; email: string } | null }>("/admin/profile").then((data) => {
        if (data.admin) {
          setAdminEmail(data.admin.email);
          setNewEmail(data.admin.email);
        }
      }),
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
    setFormWeight(1);
  }

  function startEdit(up: Upstream) {
    setEditingId(up.id);
    setFormName(up.name);
    setFormBaseUrl(up.baseUrl);
    setFormApiKey(up.apiKey);
    setFormWeight(up.weight);
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
          body: JSON.stringify({ name: formName, base_url: formBaseUrl, api_key: formApiKey, weight: formWeight })
        });
        toast("Upstream updated", "success");
      } else {
        await api("/admin/upstreams", {
          method: "POST",
          body: JSON.stringify({ name: formName, base_url: formBaseUrl, api_key: formApiKey, is_active: true, weight: formWeight })
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

  async function syncUpstream(id: string) {
    try {
      const res = await api<{ synced: number; message: string }>(`/admin/upstreams/${id}/sync`, { method: "POST" });
      toast(res.message ?? "Models synced", "success");
    } catch {
      toast("Failed to sync models", "error");
    }
  }

  async function saveEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!email) { toast("Email is required", "error"); return; }
    try { new URL(`https://${email}`); } catch {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Invalid email format", "error"); return; }
    }
    if (email === adminEmail) { toast("Email unchanged", "info"); return; }
    setEmailSaving(true);
    try {
      await api<{ ok: boolean; email: string }>("/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ email })
      });
      setAdminEmail(email);
      toast("Email updated", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update email", "error");
    } finally {
      setEmailSaving(false);
    }
  }

  async function savePassword() {
    if (!currentPassword) { toast("Current password is required", "error"); return; }
    if (newPassword.length < 6) { toast("New password must be at least 6 characters", "error"); return; }
    if (newPassword !== confirmPassword) { toast("Passwords do not match", "error"); return; }
    setPwSaving(true);
    try {
      await api<{ ok: boolean }>("/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("Password changed", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to change password", "error");
    } finally {
      setPwSaving(false);
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
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-text-primary">Settings</h2>
        <p className="text-sm text-text-secondary mt-1">Manage your account and upstream configuration</p>
      </div>

      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-4 w-4" /> Admin Account</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <Input
            label="Email / Username"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="admin@example.com"
          />
          <div className="pt-1">
            <Button onClick={saveEmail} loading={emailSaving} disabled={newEmail.trim().toLowerCase() === adminEmail}>
              Update Email
            </Button>
          </div>
        </div>
      </Card>

      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Change Password</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <PasswordInput
            label="Current Password"
            value={currentPassword}
            onChange={setCurrentPassword}
            show={showCurrentPw}
            onToggleShow={() => setShowCurrentPw((v) => !v)}
            placeholder="Enter current password"
          />
          <PasswordInput
            label="New Password"
            value={newPassword}
            onChange={setNewPassword}
            show={showNewPw}
            onToggleShow={() => setShowNewPw((v) => !v)}
            placeholder="Min 6 characters"
          />
          <PasswordInput
            label="Confirm New Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showNewPw}
            onToggleShow={() => setShowNewPw((v) => !v)}
            placeholder="Re-enter new password"
          />
          <div className="pt-1">
            <Button onClick={savePassword} loading={pwSaving} disabled={!currentPassword || !newPassword || !confirmPassword}>
              Change Password
            </Button>
          </div>
        </div>
      </Card>

      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle>Upstream Configuration</CardTitle>
        </CardHeader>
        <p className="text-xs text-text-muted mb-4">
          Multiple upstreams are supported with weighted round-robin load balancing and automatic failover.
        </p>

        {/* Form */}
        <div className="space-y-4 mb-6 p-4 rounded-lg border border-border bg-surface-secondary">
          <h3 className="text-sm font-semibold text-text-primary">{editingId ? "Edit Upstream" : "Add New Upstream"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., Alibaba Primary" />
            <Input label="Base URL" value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-text-secondary">API Key</label>
              <input
                type="password"
                value={formApiKey}
                onChange={(e) => setFormApiKey(e.target.value)}
                placeholder="sk-..."
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
              />
            </div>
            <Input label="Weight (Round-Robin)" type="number" min={1} value={String(formWeight)} onChange={(e) => setFormWeight(Number(e.target.value) || 1)} placeholder="1" />
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
                <th className="pb-2">API Key</th>
                <th className="pb-2 text-center">Weight</th>
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
                      {up.apiKey.slice(0, 6)}...{up.apiKey.slice(-4)}
                    </td>
                    <td className="py-3 text-center text-text-secondary">{up.weight}</td>
                    <td className="py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${up.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${up.isActive ? "bg-green-400" : "bg-red-400"}`}></span>
                        {up.isActive ? "Active" : "Off"}
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => syncUpstream(up.id)} title="Sync Models">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
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

function PasswordInput({ label, value, onChange, show, onToggleShow, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-text-secondary">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-border bg-surface px-3 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary cursor-pointer"
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
