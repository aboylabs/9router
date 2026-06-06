import { formatDateMY, formatNumber } from "./utils";

export interface CopyKeyData {
  apiKey: string;
  quotaTokens: number | string | null;
  expiresAt: string | null;
  createdAt?: string | null;
  dailyReset?: boolean;
  dailyQuotaTokens?: number | string | null;
  email?: string;
  password?: string;
}

export function buildCopyText(data: CopyKeyData): string {
  const quotaLine = data.dailyReset
    ? `Quota: ${formatNumber(data.dailyQuotaTokens || 50000000)} tokens/day (resets daily at 00:00 WIB)`
    : data.quotaTokens === null || data.quotaTokens === "Unlimited"
      ? `Quota: Unlimited`
      : `Quota: ${formatNumber(data.quotaTokens)} tokens`;

  const lines = [
    `Base URL: http://43.128.67.88/v1`,
    `API Key: ${data.apiKey}`,
    ``,
  ];

  lines.push(quotaLine);
  lines.push(`Created at: ${formatDateMY(data.createdAt ?? null)}`);
  lines.push(`Expired at: ${formatDateMY(data.expiresAt)}`);

  return lines.join("\n");
}