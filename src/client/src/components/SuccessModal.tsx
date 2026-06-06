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
    email: string;
    password: string;
    package: {
      id: string | null;
      label: string;
      quota_tokens: number | null;
      daily_quota_tokens: number | null;
      daily_reset: boolean;
      expires_at: string;
    };
    created_at?: string;
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
            <DialogTitle>API Key Created</DialogTitle>
          </div>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-text-muted uppercase">API Key</p>
            <code className="block w-full px-3 py-2 rounded-md bg-sidebar text-emerald-300 text-xs font-mono break-all">
              {data.apiKey}
            </code>
          </div>
          {data.name && <InfoRow label="Nama User" value={data.name} />}
          <InfoRow label="Base URL" value="http://43.128.67.88/v1" />
          <div className="border-t border-border my-3" />
          <InfoRow label="Quota" value={quotaDisplay} />
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