/**
 * Compact sidebar reconciliation helpers.
 * Last reconciled comes from ReconciledDay rows, never adjusted or starting-balance dates.
 */

const SIDEBAR_RECONCILE_STALE_DAYS = 7;
const SIDEBAR_RECONCILE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sidebarReconcileNormalizeIso(raw) {
  if (raw == null || raw === "") return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw));
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function sidebarReconcileAddDays(iso, days) {
  const d = sidebarReconcileNormalizeIso(iso);
  if (!d) return "";
  const p = d.split("-").map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + Number(days || 0)));
  return dt.toISOString().slice(0, 10);
}

function sidebarReconcileDaysSince(lastIso, todayIso) {
  const last = sidebarReconcileNormalizeIso(lastIso);
  const today = sidebarReconcileNormalizeIso(todayIso);
  if (!last || !today) return null;
  const a = Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1, Number(last.slice(8, 10)));
  const b = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

function defaultReconcileIso(todayIso, startIso) {
  const today = sidebarReconcileNormalizeIso(todayIso);
  if (!today) return "";
  const start = sidebarReconcileNormalizeIso(startIso);
  if (start && today < start) return start;
  return today;
}

function clampReconcileIso(iso, todayIso, startIso) {
  const today = sidebarReconcileNormalizeIso(todayIso);
  const start = sidebarReconcileNormalizeIso(startIso);
  let d = sidebarReconcileNormalizeIso(iso);
  if (!d) d = defaultReconcileIso(today, start);
  if (today && d > today) d = today;
  if (start && d < start) d = start;
  return d;
}

function sidebarReconcileTone(daysSince) {
  if (daysSince == null || !Number.isFinite(Number(daysSince))) return "none";
  return Number(daysSince) >= SIDEBAR_RECONCILE_STALE_DAYS ? "stale" : "neutral";
}

function formatSidebarReconcileDate(iso) {
  const d = sidebarReconcileNormalizeIso(iso);
  if (!d) return "";
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(day)) return d;
  return `${SIDEBAR_RECONCILE_MONTHS[m - 1]} ${day}`;
}

function formatSidebarReconcileElapsed(daysSince) {
  const n = Number(daysSince);
  if (!Number.isFinite(n) || n < SIDEBAR_RECONCILE_STALE_DAYS) return "";
  if (n === 1) return "1 day ago";
  return `${n} days ago`;
}

function latestIsoFromDateSets(sets) {
  let latest = "";
  for (const group of sets || []) {
    if (!group) continue;
    const values = group instanceof Set ? group : Array.isArray(group) ? group : [];
    for (const raw of values) {
      const iso = sidebarReconcileNormalizeIso(raw);
      if (iso && (!latest || iso > latest)) latest = iso;
    }
  }
  return latest || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SIDEBAR_RECONCILE_STALE_DAYS,
    sidebarReconcileNormalizeIso,
    sidebarReconcileAddDays,
    sidebarReconcileDaysSince,
    defaultReconcileIso,
    clampReconcileIso,
    sidebarReconcileTone,
    formatSidebarReconcileDate,
    formatSidebarReconcileElapsed,
    latestIsoFromDateSets,
  };
}
