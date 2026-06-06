import { useEffect, useState } from "react";
import { Eye, EyeOff, RefreshCw, User, Lock, Monitor, Smartphone, LogOut } from "lucide-react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { api } from "../lib/api";

type UpstreamSettings = {
  upstream_base_url: string;
  upstream_api_key_masked: string;
  upstream_api_key_length: number;
};

export function Settings() {
  const { toast } = useToast();

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

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
      api<UpstreamSettings>("/admin/settings/upstream").then((data) => {
        setBaseUrl(data.upstream_base_url);
        setMaskedKey(data.upstream_api_key_masked);
      }),
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
    }).finally(() => setInitialLoading(false));
  }, []);

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

  async function saveUpstream() {
    if (!baseUrl.trim()) { toast("Base URL is required", "error"); return; }
    try { new URL(baseUrl); } catch { toast("Invalid URL format", "error"); return; }
    setLoading(true);
    const payload: Record<string, string> = { upstream_base_url: baseUrl.trim() };
    if (apiKey.trim()) payload.upstream_api_key = apiKey.trim();
    try {
      const result = await api<{ saved: boolean; synced: number; message?: string; warning?: string }>("/admin/settings/upstream", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      if (result.warning) toast(result.warning, "error");
      else toast(result.message ?? "Upstream settings saved and models synced", "success");
      setApiKey("");
      const data = await api<UpstreamSettings>("/admin/settings/upstream");
      setBaseUrl(data.upstream_base_url);
      setMaskedKey(data.upstream_api_key_masked);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save settings", "error");
    } finally {
      setLoading(false);
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
      setSessions((prev) => prev.slice(0, 1)); // Keep only first (current)
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

  if (initialLoading) {
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

      <Card className="w-full max-w-2xl">
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

      <Card className="w-full max-w-2xl">
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

      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Upstream Configuration</CardTitle>
        </CardHeader>
        <p className="text-xs text-text-muted mb-4">
          Changes here update the proxy backend immediately and auto-refresh the available model list.
        </p>
        <div className="space-y-4">
          <Input
            label="Base URL"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://example.com/v1"
          />
          <div className="grid gap-1.5">
            <label className="text-sm font-medium text-text-secondary">API Key</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={maskedKey || "Enter to update"}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary cursor-pointer"
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-text-muted">
              Leave blank to keep the current key.
            </p>
          </div>
          <div className="pt-2">
            <Button onClick={saveUpstream} loading={loading}>
              Save & Sync Models
            </Button>
          </div>
        </div>
      </Card>

      {/* Active Sessions */}
      <Card className="w-full max-w-2xl">
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
