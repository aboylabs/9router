import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { CopyButton } from "./CopyButton";
import { buildCopyText } from "../lib/copy";
import { formatDateMY, formatNumber } from "../lib/utils";

interface SuccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: {
    apiKey: string;
    name?: string;
    email?: string;
    password?: string;
    title?: string;
    warning?: string;
    package: {
      id: string | null;
      label: string;
      quota_tokens: number | null;
      daily_quota_tokens: number | null;
      daily_reset: boolean;
      rate_limit_rpm?: number | null;
      expires_at: string | Date | null;
    };
    created_at?: string | Date;
  };
}

export function SuccessModal({ open, onOpenChange, data }: SuccessModalProps) {
  const quotaDisplay = data.package.quota_tokens === null
    ? "Unlimited"
    : data.package.daily_reset
      ? `${formatNumber(data.package.daily_quota_tokens ?? 0)} tokens/day (resets daily at 00:00 WIB)`
      : `${formatNumber(data.package.quota_tokens)} tokens`;

  const copyText = buildCopyText({
    apiKey: data.apiKey,
    quotaTokens: data.package.quota_tokens,
    expiresAt: data.package.expires_at,
    createdAt: data.created_at ?? null,
    dailyReset: data.package.daily_reset,
    dailyQuotaTokens: data.package.daily_quota_tokens
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-emerald-50 dark:bg-emerald-950">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <DialogTitle>{data.title ?? "API Key Created"}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {data.warning ? (
            <p className="text-xs text-amber-600 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              {data.warning}
            </p>
          ) : null}
          <div className="space-y-1">
            <p className="text-xs font-medium text-text-muted uppercase">API Key</p>
            <code className="block w-full px-3 py-2 rounded-md bg-sidebar text-emerald-300 text-xs font-mono break-all">
              {data.apiKey}
            </code>
          </div>
          {data.name && <InfoRow label="Nama User" value={data.name} />}
          <InfoRow label="Base URL" value="https://routers9.web.id/v1" />
          <div className="border-t border-border my-3" />
          {data.package.label ? <InfoRow label="Paket" value={data.package.label} /> : null}
          <InfoRow label="Quota" value={quotaDisplay} />
          {data.package.rate_limit_rpm != null ? (
            <InfoRow label="RPM" value={`${data.package.rate_limit_rpm} req/min`} />
          ) : null}
          <InfoRow label="Created" value={formatDateMY(data.created_at ?? "")} />
          <InfoRow label="Expired" value={formatDateMY(data.package.expires_at)} />
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
          <CopyButton text={copyText} variant="button" label="Copy All" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs font-medium text-text-muted uppercase shrink-0">{label}</span>
      <span className="text-sm text-text-primary text-right break-all">{value}</span>
    </div>
  );
}