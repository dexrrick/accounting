import { defaultLiveRegulatoryFeedService, type RegulatoryUpdatePackage } from './liveRegulatoryFeed';

type Authority = RegulatoryUpdatePackage['authority'];
const STORAGE_KEY = 'regulatory_update_last_check_v1';
const DAILY: Authority[] = ['IRAS', 'CPF', 'MOM'];
const WEEKLY: Authority[] = ['AGC', 'ACRA'];

function readLastChecks(): Partial<Record<Authority, number>> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function writeLastChecks(checks: Partial<Record<Authority, number>>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(checks)); } catch { /* storage unavailable */ }
}

/** Runs only due official checks while the app is open; candidates still require review and activation. */
export async function runDueRegulatoryChecks(now = Date.now()): Promise<Authority[]> {
  if (typeof window === 'undefined') return [];
  const lastChecks = readLastChecks();
  const due = [...DAILY.filter(a => now - (lastChecks[a] || 0) >= 86_400_000), ...WEEKLY.filter(a => now - (lastChecks[a] || 0) >= 604_800_000)];
  if (due.length === 0) return [];
  await defaultLiveRegulatoryFeedService.checkForUpdates(undefined, { authorities: due });
  for (const authority of due) lastChecks[authority] = now;
  writeLastChecks(lastChecks);
  return due;
}
