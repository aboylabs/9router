import { query } from "./db.js";
import { invalidateApiKeyCache } from "./repositories.js";

let lastResetDate: string | null = null;

function getIndonesiaDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

async function checkAndReset() {
  const today = getIndonesiaDate();
  if (lastResetDate === today) return;

  // First run: set lastResetDate without resetting (avoid double-reset on server restart)
  if (lastResetDate === null) {
    lastResetDate = today;
    console.log(`[daily-reset] Initialized. Current date (WIB): ${today}`);
    return;
  }

  // Date has changed — reset daily keys
  try {
    // Include keys with no expiry (expires_at IS NULL) and keep used_requests as lifetime counter
    const result = await query(
      `UPDATE api_keys
       SET used_tokens = 0
       WHERE daily_reset = true
         AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())`
    );
    const count = result.rowCount ?? 0;
    lastResetDate = today;
    // Clear in-memory key cache so proxy immediately sees used_tokens = 0
    invalidateApiKeyCache();
    console.log(`[daily-reset] Reset ${count} daily-reset key(s) at ${new Date().toISOString()} (WIB date: ${today})`);
  } catch (err) {
    console.error(`[daily-reset] Failed to reset daily keys:`, err);
  }
}

export function startDailyResetCron() {
  // Check every 60 seconds
  checkAndReset();
  setInterval(checkAndReset, 60_000);
  console.log(`[daily-reset] Cron started. Checks every 60s for midnight WIB.`);
}
