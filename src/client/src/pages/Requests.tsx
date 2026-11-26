import { useCallback, useEffect, useState } from "react";
import { Eye, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { CopyButton } from "../components/CopyButton";
import { api } from "../lib/api";
import { SuperAdminBadge } from "../components/SuperAdminBadge";
import { SupporterBadge } from "../components/SupporterBadge";
import { HelperBadge } from "../components/HelperBadge";
import { UltraBadge } from "../components/UltraBadge";
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

type RequestLog = {
  id: string;
  created_at: string;
  buyer_name: string | null;
  key_prefix: string | null;
  quota_tokens?: string | null;
  is_ultra?: boolean;
  access_roles?: string[] | null;
  model_id: string | null;
  status_code: number;
  success: boolean;
  prompt_tokens: string | number;
  completion_tokens: string | number;
  total_tokens: string | number;
  latency_ms: number;
  error_code: string | null;
  ip_address: string | null;
  user_prompt: string | null;
  prompt_truncated: boolean;
  ai_response?: string | null;
  response_truncated?: boolean;
};

type StatusFilter = "all" | "ok" | "fail";
type HoursFilter = 1 | 6 | 24 | 72 | 168;

const PAGE_SIZE = 80;
const HOUR_OPTIONS: { value: HoursFilter; label: string }[] = [
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 24, label: "24h" },
  { value: 72, label: "3d" },
  { value: 168, label: "7d" }
];

function modelShort(id: string | null) {
  if (!id) return "-";
  return id.replace(/^routers9\//, "");
}

function BuyerMarks({ name, quota, ultra, accessRoles }: { name: string | null; quota?: string | null; ultra?: boolean; accessRoles?: string[] | null }) {
  return (
    <>
      {isSuperAdminName(name, accessRoles) ? <SuperAdminBadge /> : null}
      {isSupporterName(name, accessRoles) ? <SupporterBadge /> : null}
      {isHelperName(name, accessRoles) ? <HelperBadge /> : null}
      {!isSuperAdminName(name, accessRoles) && !isSupporterName(name, accessRoles) && !isHelperName(name, accessRoles) && isUltraKey(ultra, quota) ? (
        <UltraBadge />
      ) : null}
    </>
  );
}

function PromptBlock({ event }: { event: RequestLog }) {
  const hasPrompt = Boolean(event.user_prompt);
  const hasResponse = Boolean(event.ai_response);

  if (!hasPrompt && !hasResponse) {
    return <p className="text-xs text-text-muted italic">No prompt or AI response captured (empty / error / before this feature).</p>;
  }

  return (
    <div className="space-y-2.5">
      {hasPrompt ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1.5">
            <span>User Prompt</span>
            {event.prompt_truncated ? (
              <span className="text-[10px] font-normal text-amber-500">(Truncated at 1KB)</span>
            ) : null}
          </div>
          <pre className="text-xs text-text-primary whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto rounded bg-surface/60 p-2 border border-border/40">
            {event.user_prompt}
          </pre>
        </div>
      ) : null}

      {hasResponse ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90 mb-1 flex items-center gap-1.5">
            <span>AI Response</span>
            {event.response_truncated ? (
              <span className="text-[10px] font-normal text-amber-500">(Truncated at 1KB)</span>
            ) : null}
          </div>
          <pre className="text-xs text-emerald-300 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto rounded bg-surface/60 p-2 border border-border/40">
            {event.ai_response}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function Requests() {
  const [events, setEvents] = useState<RequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [hours, setHours] = useState<HoursFilter>(24);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchRequests = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        status,
        hours: String(hours),
        limit: String(PAGE_SIZE),
        offset: String(offset)
      });
      if (appliedSearch.trim()) params.set("q", appliedSearch.trim());
      const data = await api<{ events: RequestLog[]; total: number }>(`/admin/requests?${params.toString()}`);
      setEvents(data.events);
      setTotal(data.total);
      setLastRefresh(new Date());
    } catch {
      // silent — same as Live
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, hours, offset, status]);

  useEffect(() => {
    setLoading(true);
    fetchRequests();
  }, [fetchRequests]);

  function applySearch() {
    setOffset(0);
    setAppliedSearch(search.trim());
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + events.length, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Eye className="h-5 w-5 text-text-muted" />}
        title="Requests"
        subtitle="Last user message · 7 days"
        actions={
          <>
            <span className="text-xs text-text-muted">
              Updated:{" "}
              {lastRefresh.toLocaleTimeString("id-ID", {
                timeZone: "Asia/Jakarta",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
              })}
            </span>
            <Button variant="outline" size="sm" onClick={fetchRequests} title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          className="relative max-w-md w-full"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch();
          }}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Buyer, key, model, IP, or prompt..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {HOUR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setHours(opt.value);
                setOffset(0);
              }}
              className={`h-8 px-2.5 rounded-md text-xs font-medium border cursor-pointer ${
                hours === opt.value
                  ? "bg-primary-600 text-white border-primary-600"
                  : "bg-surface text-text-secondary border-border hover:bg-surface-tertiary"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setOffset(0);
            }}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
          >
            <option value="all">All status</option>
            <option value="ok">OK only</option>
            <option value="fail">Failed only</option>
          </select>
        </div>
      </div>

      <div className="text-xs text-text-muted">
        Showing {from}-{to} of {formatNumber(total)} in the last {hours === 168 ? "7 days" : hours === 72 ? "3 days" : `${hours}h`}
      </div>

      {loading ? (
        <p className="text-sm text-text-muted text-center py-8">Loading...</p>
      ) : events.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted text-center py-6">
            {appliedSearch || status !== "all"
              ? "No requests match these filters."
              : "No request logs yet. New chats after restart will appear here."}
          </p>
        </Card>
      ) : (
        <>
          <div className="lg:hidden space-y-3">
            {events.map((event) => {
              const open = openId === event.id;
              return (
                <div
                  key={event.id}
                  className={`border border-border rounded-lg p-3 space-y-2 bg-surface${
                    roleRowClassName(event.buyer_name, event.quota_tokens, event.is_ultra)
                      ? " " + roleRowClassName(event.buyer_name, event.quota_tokens, event.is_ultra)
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">{formatDateShort(event.created_at)}</span>
                    <Badge variant={event.success ? "success" : "danger"}>{event.status_code}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`truncate font-medium text-sm ${buyerNameClassName(event.buyer_name, event.quota_tokens, event.is_ultra, event.access_roles)}`}>
                        {event.buyer_name || "-"}
                      </span>
                      <BuyerMarks name={event.buyer_name} quota={event.quota_tokens} ultra={event.is_ultra} accessRoles={event.access_roles} />
                    </div>
                    <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded shrink-0">{modelShort(event.model_id)}</code>
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{event.ip_address || "no IP"}</span>
                    <span>
                      {formatNumber(event.total_tokens)} tok · {event.latency_ms}ms
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : event.id)}
                    className="text-xs text-primary-500 font-medium cursor-pointer"
                  >
                    {open ? "Hide details" : "Show prompt & response"}
                  </button>
                  {open ? <PromptBlock event={event} /> : null}
                </div>
              );
            })}
          </div>

          <div className="hidden lg:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-surface-secondary/95 border-b border-border">
                <tr>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">Time</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">Buyer</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">Key</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">Model</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">IP</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">Status</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider">Tokens</th>
                  <th className="px-2 py-2.5 text-left text-[11px] font-semibold text-text-muted uppercase tracking-wider min-w-[280px]">Prompt &amp; Response</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((event) => {
                  const open = openId === event.id;
                  return (
                    <tr
                      key={event.id}
                      className={`hover:bg-surface-secondary/60 ${roleRowClassName(event.buyer_name, event.quota_tokens, event.is_ultra) || ""}`}
                    >
                      <td className="px-2 py-2.5 text-text-secondary whitespace-nowrap align-top">{formatDateShort(event.created_at)}</td>
                      <td className="px-2 py-2.5 align-top">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-medium ${buyerNameClassName(event.buyer_name, event.quota_tokens, event.is_ultra, event.access_roles)}`}>
                            {event.buyer_name || "-"}
                          </span>
                          <BuyerMarks name={event.buyer_name} quota={event.quota_tokens} ultra={event.is_ultra} accessRoles={event.access_roles} />
                        </div>
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        {event.key_prefix ? (
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-surface-tertiary px-1.5 py-0.5 rounded font-mono">{event.key_prefix}</code>
                            <CopyButton text={event.key_prefix} />
                          </div>
                        ) : (
                          <span className="text-text-muted">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-text-secondary align-top whitespace-nowrap">{modelShort(event.model_id)}</td>
                      <td className="px-2 py-2.5 align-top">
                        {event.ip_address ? (
                          <code className="text-xs font-mono text-text-muted">{event.ip_address}</code>
                        ) : (
                          <span className="text-text-muted">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <Badge variant={event.success ? "success" : "danger"}>{event.status_code}</Badge>
                        {event.error_code ? <div className="text-[10px] text-text-muted mt-1">{event.error_code}</div> : null}
                      </td>
                      <td className="px-2 py-2.5 text-text-secondary align-top whitespace-nowrap">
                        {formatNumber(event.total_tokens)}
                        <div className="text-[10px] text-text-muted">{event.latency_ms}ms</div>
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : event.id)}
                          className="text-left w-full cursor-pointer"
                        >
                          {event.user_prompt ? (
                            <span className="text-xs text-text-secondary line-clamp-2 break-all">{event.user_prompt}</span>
                          ) : (
                            <span className="text-xs text-text-muted italic">no prompt</span>
                          )}
                          {event.ai_response ? (
                            <div className="text-[11px] text-emerald-400/80 line-clamp-1 break-all mt-0.5 font-mono">
                              ↳ {event.ai_response}
                            </div>
                          ) : null}
                        </button>
                        {open ? (
                          <div className="mt-2 rounded-md border border-border bg-surface-secondary/60 p-2">
                            <PromptBlock event={event} />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={!canPrev}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </Button>
          <span className="text-xs text-text-muted">
            Page {Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
