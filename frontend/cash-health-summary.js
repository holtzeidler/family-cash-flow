/**
 * Cash Health reads the calendar's own daily balances (calendar-month-daily rows).
 * It never recalculates the forecast, so the card and the calendar cannot disagree.
 */

const CASH_HEALTH_WINDOW_DAYS = 90;
/** How far back from the first concerning date to look for the payments that led to it. */
const CASH_HEALTH_RUN_UP_MAX_DAYS = 14;
/** Named payments must cover at least this share of run-up outflows; otherwise describe them together. */
const CASH_HEALTH_NAMED_SHARE = 0.6;
/** A second payment is named only when it is a meaningful part of the run-up (or of that day's outflows). */
const CASH_HEALTH_SECOND_PAYMENT_SHARE = 0.25;
/** Named rows on the card, crossing-day first, then earlier. */
const CASH_HEALTH_MAX_PAYMENTS = 3;
const CASH_HEALTH_MAX_CROSSING = 2;

const CASH_HEALTH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cashHealthAddDays(iso, days) {
  const p = String(iso || "").split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.toISOString().slice(0, 10);
}

function cashHealthCents(n) {
  return Math.round(Number(n) * 100);
}

function cashHealthWindow(todayIso, windowDays = CASH_HEALTH_WINDOW_DAYS) {
  return { startIso: todayIso, endIso: cashHealthAddDays(todayIso, windowDays - 1) };
}

/** YYYY-MM for every month the window touches, in order. */
function cashHealthMonthsInRange(startIso, endIso) {
  const out = [];
  if (!startIso || !endIso || endIso < startIso) return out;
  let y = Number(startIso.slice(0, 4));
  let m = Number(startIso.slice(5, 7));
  const endKey = endIso.slice(0, 7);
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key === endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function cashHealthRow(rows, iso) {
  if (!rows) return null;
  const row = typeof rows.get === "function" ? rows.get(iso) : rows[iso];
  return row && typeof row === "object" ? row : null;
}

function cashHealthEndAt(rows, iso) {
  const row = cashHealthRow(rows, iso);
  if (!row || row.end == null) return null;
  const n = Number(row.end);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Map<string,{end:number,txNet?:number}>} rows daily balances keyed by YYYY-MM-DD
 * @param {{todayIso:string, minimum?:number|null, windowDays?:number}} opts
 */
function summarizeCashHealth(rows, { todayIso, minimum = null, windowDays = CASH_HEALTH_WINDOW_DAYS } = {}) {
  const { startIso, endIso } = cashHealthWindow(todayIso, windowDays);
  const minNum = Number(minimum);
  const hasMinimum = minimum != null && Number.isFinite(minNum) && minNum > 0;
  const minCents = hasMinimum ? cashHealthCents(minNum) : 0;
  const base = {
    todayIso,
    windowStartIso: startIso,
    windowEndIso: endIso,
    windowDays,
    hasMinimum,
    minimum: hasMinimum ? minNum : null,
  };

  let firstBelow = null;
  let firstNegative = null;
  let lowest = null;
  for (let iso = startIso; iso <= endIso; iso = cashHealthAddDays(iso, 1)) {
    const end = cashHealthEndAt(rows, iso);
    if (end == null) return { ...base, state: "unavailable", missingIso: iso };
    const c = cashHealthCents(end);
    if (!lowest || c < cashHealthCents(lowest.amount)) lowest = { date: iso, amount: end };
    if (hasMinimum && !firstBelow && c < minCents) firstBelow = { date: iso, amount: end };
    if (!firstNegative && c < 0) firstNegative = { date: iso, amount: end };
  }

  const state = firstNegative ? "negative" : firstBelow ? "below" : "healthy";
  const anchor = firstNegative || firstBelow || null;
  let recovery = null;
  if (anchor && lowest) {
    const levelCents = state === "negative" ? 0 : minCents;
    for (let iso = cashHealthAddDays(lowest.date, 1); iso <= endIso; iso = cashHealthAddDays(iso, 1)) {
      const end = cashHealthEndAt(rows, iso);
      if (end != null && cashHealthCents(end) >= levelCents) {
        recovery = { date: iso, amount: end };
        break;
      }
    }
  }
  return {
    ...base,
    state,
    firstBelow,
    firstNegative,
    lowest,
    anchor,
    recovery,
    startsToday: !!(anchor && anchor.date === todayIso),
  };
}

function cashHealthTxNetAt(rows, iso) {
  const row = cashHealthRow(rows, iso);
  const n = row && row.txNet != null ? Number(row.txNet) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Days whose activity led into the first concerning date: the uninterrupted decline since the
 * balance last went up (usually the last deposit), at most two weeks, never before today.
 */
function cashHealthRunUpRange(summary, rows) {
  if (!summary || !summary.anchor || summary.startsToday) return null;
  const anchorIso = summary.anchor.date;
  let earliest = cashHealthAddDays(anchorIso, -(CASH_HEALTH_RUN_UP_MAX_DAYS - 1));
  if (earliest < summary.todayIso) earliest = summary.todayIso;
  let startIso = anchorIso;
  for (let iso = cashHealthAddDays(anchorIso, -1); iso >= earliest; iso = cashHealthAddDays(iso, -1)) {
    const net = cashHealthTxNetAt(rows, iso);
    if (net == null || cashHealthCents(net) > 0) break;
    startIso = iso;
  }
  while (startIso < anchorIso && cashHealthCents(cashHealthTxNetAt(rows, startIso) || 0) === 0) {
    startIso = cashHealthAddDays(startIso, 1);
  }
  const startRow = cashHealthRow(rows, startIso);
  const startBalance = startRow && startRow.start != null && Number.isFinite(Number(startRow.start)) ? Number(startRow.start) : null;
  return {
    startIso,
    endIso: anchorIso,
    drop: startBalance != null ? startBalance - summary.anchor.amount : null,
  };
}

/**
 * Explain the run-up with the calendar's own (deduplicated) day items.
 * @param {{startIso:string,endIso:string,peak:any,drop:number|null}|null} range
 * @param {Map<string, Array<{kind:string,amount:number,label:string,variable?:boolean,ref?:string}>>} itemsByDay
 * @param {Map<string,{txNet?:number}>} rows
 */
function explainCashHealthRunUp(range, itemsByDay, rows) {
  if (!range) return null;
  const outflows = [];
  for (let iso = range.startIso; iso <= range.endIso; iso = cashHealthAddDays(iso, 1)) {
    const row = cashHealthRow(rows, iso);
    const txNet = row && row.txNet != null ? Number(row.txNet) : NaN;
    const items = (itemsByDay && typeof itemsByDay.get === "function" ? itemsByDay.get(iso) : null) || [];
    let netCents = 0;
    for (const it of items) {
      const amt = Math.abs(Number(it.amount || 0));
      if (!Number.isFinite(amt)) continue;
      const isIncome = String(it.kind || "").toLowerCase() === "income";
      netCents += isIncome ? cashHealthCents(amt) : -cashHealthCents(amt);
      if (!isIncome && amt > 0) outflows.push({ ...it, date: iso, amount: amt });
    }
    if (!Number.isFinite(txNet) || Math.abs(netCents - cashHealthCents(txNet)) > 1) {
      return range.drop != null && range.drop > 0
        ? { kind: "aggregate", startIso: range.startIso, endIso: range.endIso, drop: range.drop }
        : null;
    }
  }
  if (!outflows.length) return null;
  const total = outflows.reduce((s, it) => s + it.amount, 0);
  const picked = pickCashHealthPayments(outflows, range.endIso, total);
  const namedTotal = picked.reduce((s, it) => s + it.amount, 0);
  if (picked.length && namedTotal >= total * CASH_HEALTH_NAMED_SHARE) {
    return { kind: "named", startIso: range.startIso, endIso: range.endIso, payments: picked, total, count: outflows.length };
  }
  const crossing = picked.filter((p) => p.date === range.endIso);
  return {
    kind: "several",
    startIso: range.startIso,
    endIso: range.endIso,
    count: outflows.length,
    total,
    payments: crossing.length ? crossing : [],
  };
}

function cashHealthPaymentSort(a, b) {
  return b.amount - a.amount || String(a.date).localeCompare(String(b.date)) || String(a.label || "").localeCompare(String(b.label || ""));
}

/**
 * Crossing-day outflows first (what takes the balance through the threshold), then earlier
 * payments that still explain a meaningful share of the run-up. Never hide the crossing day
 * just because an earlier bill is larger.
 */
function pickCashHealthPayments(outflows, crossingIso, total) {
  const crossing = outflows.filter((p) => p.date === crossingIso).sort(cashHealthPaymentSort);
  const earlier = outflows.filter((p) => p.date !== crossingIso).sort(cashHealthPaymentSort);
  const crossingTotal = crossing.reduce((s, it) => s + it.amount, 0);
  const picked = [];
  if (crossing[0]) {
    picked.push(crossing[0]);
    if (
      crossing[1] &&
      picked.length < CASH_HEALTH_MAX_CROSSING &&
      crossing[1].amount >= crossingTotal * CASH_HEALTH_SECOND_PAYMENT_SHARE
    ) {
      picked.push(crossing[1]);
    }
  }
  const pickedSum = () => picked.reduce((s, p) => s + p.amount, 0);
  for (const p of earlier) {
    if (picked.length >= CASH_HEALTH_MAX_PAYMENTS) break;
    if (total > 0 && pickedSum() >= total * CASH_HEALTH_NAMED_SHARE) break;
    const significant = total > 0 && p.amount >= total * CASH_HEALTH_SECOND_PAYMENT_SHARE;
    if (significant || p === earlier[0]) picked.push(p);
  }
  return picked;
}

function cashHealthDayDiff(startIso, endIso) {
  const a = Date.parse(`${startIso}T12:00:00Z`);
  const b = Date.parse(`${endIso}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round((b - a) / 86400000);
}

function cashHealthMonthDay(iso, todayIso) {
  if (todayIso && iso === todayIso) return "today";
  const m = Number(String(iso).slice(5, 7));
  const d = Number(String(iso).slice(8, 10));
  return `${CASH_HEALTH_MONTHS[m - 1] || ""} ${d}`;
}

function cashHealthRangeLabel(startIso, endIso) {
  if (startIso === endIso) return `on ${cashHealthMonthDay(endIso)}`;
  const sameMonth = startIso.slice(0, 7) === endIso.slice(0, 7);
  const end = sameMonth ? String(Number(endIso.slice(8, 10))) : cashHealthMonthDay(endIso);
  return `${cashHealthMonthDay(startIso)}–${end}`;
}

function cashHealthMoney(n) {
  const num = Number(n);
  const abs = Math.round(Math.abs(num)).toLocaleString("en-US");
  return `${Math.round(num) < 0 ? "−" : ""}$${abs}`;
}

function cashHealthPaymentText(p, withDate) {
  const label = `${String(p.label || "Payment").trim()}${p.variable ? " (est.)" : ""}`;
  return `${label} −$${Math.round(p.amount).toLocaleString("en-US")}${withDate ? ` (${cashHealthMonthDay(p.date)})` : ""}`;
}

function cashHealthPaymentsLine(expl) {
  if (!expl) return "";
  if (expl.kind === "aggregate") {
    return `Balance falls ${cashHealthMoney(expl.drop)} ${cashHealthRangeLabel(expl.startIso, expl.endIso)}`;
  }
  if (expl.kind === "named") {
    return expl.payments.map((p) => cashHealthPaymentText(p, true)).join("; ");
  }
  return `${expl.count} payments ${cashHealthRangeLabel(expl.startIso, expl.endIso)} total $${Math.round(expl.total).toLocaleString(
    "en-US"
  )}`;
}

/** References for the calendar lines to highlight (tx:ID or exp:SERIES|YYYY-MM-DD). */
function cashHealthHighlightRefs(expl) {
  if (!expl || !Array.isArray(expl.payments)) return [];
  return expl.payments.map((p) => p.ref).filter(Boolean);
}

/**
 * Card wording. Plain strings only; the caller escapes them.
 * Payment selection stays on `expl` for calendar highlighting; the card itself is status-only.
 * @returns {{tone:"healthy"|"below"|"negative", kicker:string, headline:string, amountText:string, whenLabel:string, descriptor:string, lines:string[],
 *   payments:Array, paymentsHeading:string, paymentsNote:string, horizon:string, viewAction:string, footer:string,
 *   actionIso:string|null, chip:string, ariaLabel:string}|null}
 */
function buildCashHealthCopy(summary, expl) {
  if (!summary || summary.state === "unavailable") return null;
  const today = summary.todayIso;
  const lowest = summary.lowest;
  const windowText = `Next ${summary.windowDays} days`;
  const emptyCard = { lines: [], payments: [], paymentsHeading: "", paymentsNote: "" };

  if (summary.state === "healthy") {
    const amountText = lowest ? cashHealthMoney(lowest.amount) : "";
    const descriptor = lowest ? "lowest projected" : "";
    return {
      tone: "healthy",
      kicker: "Looking good",
      headline: "Looking good",
      amountText,
      whenLabel: "",
      descriptor,
      ...emptyCard,
      horizon: windowText,
      viewAction: "",
      footer: windowText,
      actionIso: null,
      chip: "",
      ariaLabel: ["Looking good", amountText && `${amountText} lowest projected`, windowText].filter(Boolean).join(". "),
    };
  }

  const anchor = summary.anchor;
  const when = cashHealthMonthDay(anchor.date, today);
  const amountText = cashHealthMoney(anchor.amount);
  const whenLabel = when === "today" ? "Today" : when;
  const viewText = when === "today" ? "View today" : `View ${when}`;
  const kicker = summary.state === "negative" ? "Negative balance projected" : "Below minimum projected";
  const chipWhen = when === "today" ? "today" : when;
  const headline = when === "today" ? `${amountText} today` : `${amountText} on ${when}`;
  return {
    tone: summary.state,
    kicker,
    headline,
    amountText,
    whenLabel,
    descriptor: "",
    ...emptyCard,
    horizon: windowText,
    viewAction: viewText,
    footer: `${windowText} · ${viewText}`,
    actionIso: anchor.date,
    chip: `${kicker} ${chipWhen} · ${amountText}`,
    ariaLabel: [kicker, headline, windowText, `Opens ${when === "today" ? "today" : when} on the calendar.`].filter(Boolean).join(". "),
  };
}

/**
 * Day items in the same shape the calendar shows them, after the calendar's own dedupe.
 * @param {{actuals:any[], expected:any[], mode:string, startIso:string, endIso:string,
 *   dedupe:(expected:any[], actuals:any[])=>{actuals:any[],expected:any[]}, labelFor:(row:any, isExpected:boolean)=>string}} input
 */
function groupCashHealthDayItems({ actuals, expected, mode, startIso, endIso, dedupe, labelFor }) {
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";
  const isoOf = (raw) => {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw || ""));
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
  };
  const byDay = new Map();
  const bucket = (iso) => {
    if (!byDay.has(iso)) byDay.set(iso, { actuals: [], expected: [] });
    return byDay.get(iso);
  };
  if (includeActual) {
    for (const tx of actuals || []) {
      const iso = isoOf(tx && tx.date);
      if (iso && iso >= startIso && iso <= endIso) bucket(iso).actuals.push(tx);
    }
  }
  if (includeExpected) {
    for (const it of expected || []) {
      const iso = isoOf(it && it.date);
      if (iso && iso >= startIso && iso <= endIso) bucket(iso).expected.push(it);
    }
  }
  const out = new Map();
  for (const [iso, b] of byDay.entries()) {
    const rows = dedupe(b.expected, b.actuals);
    const items = [];
    for (const tx of rows.actuals) {
      items.push({
        kind: String(tx.kind || ""),
        amount: Math.abs(Number(tx.amount || 0)),
        label: labelFor(tx, false),
        variable: false,
        ref: Number(tx.id) > 0 ? `tx:${Number(tx.id)}` : "",
      });
    }
    for (const it of rows.expected) {
      const occ = isoOf(it.occurrence_date || it.date) || iso;
      items.push({
        kind: String(it.kind || ""),
        amount: Math.abs(Number(it.amount || 0)),
        label: labelFor(it, true),
        variable: !!it.variable,
        ref: Number(it.expected_transaction_id) > 0 ? `exp:${Number(it.expected_transaction_id)}|${occ}` : "",
      });
    }
    out.set(iso, items);
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CASH_HEALTH_WINDOW_DAYS,
    cashHealthAddDays,
    cashHealthWindow,
    cashHealthMonthsInRange,
    summarizeCashHealth,
    cashHealthRunUpRange,
    explainCashHealthRunUp,
    pickCashHealthPayments,
    cashHealthPaymentsLine,
    cashHealthHighlightRefs,
    buildCashHealthCopy,
    groupCashHealthDayItems,
    cashHealthMoney,
  };
}
