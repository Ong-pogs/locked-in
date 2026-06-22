// One-shot leaderboard snapshot refresh for cron services.
// Render cron: schedule "0 0 * * *" (daily UTC), command:
//   npm run cron:leaderboard-refresh
import { config as loadEnv } from 'dotenv';

loadEnv();

const apiBaseUrl = process.env.LEADERBOARD_REFRESH_BASE_URL
  ?? process.env.API_BASE_URL
  ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
const refreshUrl = process.env.LEADERBOARD_REFRESH_URL
  ?? `${apiBaseUrl.replace(/\/+$/, '')}/v1/internal/leaderboard/refresh`;
const schedulerSecret = process.env.SCHEDULER_SECRET;
const pageSize = Number.parseInt(process.env.LEADERBOARD_SNAPSHOT_PAGE_SIZE ?? '25', 10);

if (!schedulerSecret) {
  console.error('SCHEDULER_SECRET is required to refresh the leaderboard snapshot.');
  process.exit(1);
}

const payload = {
  limit: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25,
};

try {
  const response = await fetch(refreshUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-scheduler-key': schedulerSecret,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    console.error('Leaderboard refresh failed.', {
      status: response.status,
      body,
    });
    process.exit(1);
  }

  console.log('Leaderboard snapshot refreshed.', {
    snapshotAt: body?.snapshotAt ?? null,
    totalEntries: body?.totalEntries ?? null,
    currentPotSizeUi: body?.currentPotSizeUi ?? null,
  });
} catch (error) {
  console.error('Leaderboard refresh request failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
