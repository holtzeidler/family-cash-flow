function apiBaseUrl() {
  const raw = window.API_BASE && window.API_BASE !== "__API_BASE__" ? String(window.API_BASE).trim() : "";
  return raw.replace(/\/+$/, "");
}

async function api(path, method = "GET", body) {
  const apiBase = apiBaseUrl();
  const fullPath = `${apiBase}${path}`;
  let res;
  try {
    res = await fetch(fullPath, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const onPages = typeof location !== "undefined" && location.hostname.endsWith("github.io");
    const origin = typeof location !== "undefined" ? location.origin : "(unknown)";
    const baseHint = apiBase
      ? `Trying API_BASE: ${apiBase}`
      : "API_BASE is empty — requests go to the Pages host (wrong).";
    const corsHint = onPages
      ? `Render env CORS_ORIGINS must include exactly: ${origin} (scheme + host, no path). Set ENV=production for login cookies.`
      : "If this is cross-origin, configure CORS on the API for this origin.";
    throw new Error(
      `${msg}\n\n${baseHint}\n${corsHint}\nIf the API is on Render free tier, wait ~1 minute for a cold start and refresh.`
    );
  }

  if (res.status === 401) {
    window.location.href = "./login.html";
    return null;
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.detail) msg = data.detail;
    } catch (_) {}
    throw new Error(msg);
  }

  // Some endpoints may return empty bodies; handle gracefully.
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

function show(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function expandSidebarSection(key) {
  const card = document.querySelector(`.sidebar-section[data-sidebar-key="${key}"]`);
  if (!card) return null;
  applySidebarSectionCollapsed(card, false);
  return card;
}

function fmtMoney(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyParens(n) {
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  const abs = Math.abs(num);
  const s = fmtMoney(abs);
  return num < 0 ? `(${s})` : s;
}

function fmtMoneyThreshold(rawInput, n) {
  const raw = String(rawInput ?? "").trim();
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return String(n ?? "");
  const showDecimals = raw.includes(".");
  if (showDecimals) return fmtMoney(num);
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDateMDY(raw) {
  const iso = normalizeIsoDate(raw) || "";
  if (!iso) return String(raw ?? "");
  // iso = YYYY-MM-DD
  const y = iso.slice(0, 4);
  const m = iso.slice(5, 7);
  const d = iso.slice(8, 10);
  if (!y || !m || !d) return String(raw ?? "");
  return `${m}-${d}-${y}`;
}

function toNum(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

let state = {
  user: null,
  families: [],
  activeFamilyId: null,
  categories: [],
  accounts: [],
  expectedTransactions: [],
  monthActualItems: [],
  upcomingActualItems: [],
  monthExpectedItems: [],
  calendarExtraActualItems: [],
  calendarExtraExpectedItems: [],
  reconciledDates: new Set(),
  monthDailyBalances: new Map(),
};

let selectedExpectedInstance = null;
let selectedExpectedMovedToDate = null;
let txEditReimbursableValue = false;
let txEditDescriptionSnapshot = "";
/** "actual" = one-time bank txn; "recurring" = expected series / occurrence */
let transactionEditMode = "actual";

const userPill = document.getElementById("userPill");
const familiesErr = document.getElementById("familiesErr");
const txErr = document.getElementById("txErr");
const catErr = document.getElementById("catErr");
const familySelect = document.getElementById("familySelect");
const monthInput = document.getElementById("monthInput");
const totalsEl = document.getElementById("totals");
const txList = document.getElementById("txList");
const txListMain = document.getElementById("txListMain");

const categoriesGrid = document.getElementById("categoriesGrid");

// Balance threshold alerts (settings + calendar sidebar)
const balanceThresholdMin = document.getElementById("balanceThresholdMin");
const balanceThresholdMax = document.getElementById("balanceThresholdMax");
const lowBalanceResult = document.getElementById("lowBalanceResult");
const lowBalanceErr = document.getElementById("lowBalanceErr");
const sidebarLowBalanceBanner = document.getElementById("sidebarLowBalanceBanner");
const sidebarHighBalanceBanner = document.getElementById("sidebarHighBalanceBanner");
const sidebarBalanceThresholdHint = document.getElementById("sidebarBalanceThresholdHint");
const BALANCE_THRESHOLD_MIN_KEY = "familyCashFlow_balanceThresholdMin";
const BALANCE_THRESHOLD_MAX_KEY = "familyCashFlow_balanceThresholdMax";
/** @deprecated migrate to BALANCE_THRESHOLD_MIN_KEY */
const LOW_BALANCE_THRESHOLD_KEY = "familyCashFlow_lowBalanceThreshold";
let lowBalanceDebounceTimer = null;
let lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };

/** @param {"off"|"danger"|"muted"} style */
function setSidebarLowBalanceBanner(text, style = "off") {
  if (!sidebarLowBalanceBanner) return;
  if (!text || style === "off") {
    sidebarLowBalanceBanner.style.display = "none";
    sidebarLowBalanceBanner.textContent = "";
    sidebarLowBalanceBanner.classList.remove("is-danger", "is-muted");
    return;
  }
  sidebarLowBalanceBanner.textContent = text;
  sidebarLowBalanceBanner.style.display = "flex";
  sidebarLowBalanceBanner.classList.remove("is-danger", "is-muted");
  sidebarLowBalanceBanner.classList.toggle("is-danger", style === "danger");
  sidebarLowBalanceBanner.classList.toggle("is-muted", style === "muted");
}

/** @param {"off"|"high"|"muted"} style */
function setSidebarHighBalanceBanner(text, style = "off") {
  if (!sidebarHighBalanceBanner) return;
  if (!text || style === "off") {
    sidebarHighBalanceBanner.style.display = "none";
    sidebarHighBalanceBanner.textContent = "";
    sidebarHighBalanceBanner.classList.remove("is-high", "is-muted");
    return;
  }
  sidebarHighBalanceBanner.textContent = text;
  sidebarHighBalanceBanner.style.display = "flex";
  sidebarHighBalanceBanner.classList.remove("is-high", "is-muted");
  sidebarHighBalanceBanner.classList.toggle("is-high", style === "high");
  sidebarHighBalanceBanner.classList.toggle("is-muted", style === "muted");
}

function setSidebarBalanceThresholdHint(text) {
  if (!sidebarBalanceThresholdHint) return;
  if (!text) {
    sidebarBalanceThresholdHint.textContent = "";
    sidebarBalanceThresholdHint.hidden = true;
    return;
  }
  sidebarBalanceThresholdHint.textContent = text;
  sidebarBalanceThresholdHint.hidden = false;
}

function getRadioValue(name, fallback = "") {
  const el = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
  return el && el.value ? el.value : fallback;
}

// Accounts
const accErr = document.getElementById("accErr");
const accountsList = document.getElementById("accountsList");
const accountName = document.getElementById("accountName");
const accountType = document.getElementById("accountType");
const accountStartingBalance = document.getElementById("accountStartingBalance");
const accountStartingBalanceDate = document.getElementById("accountStartingBalanceDate");
const accountEditId = document.getElementById("accountEditId");
const addAccountBtn = document.getElementById("addAccountBtn");
const saveAccountEditBtn = document.getElementById("saveAccountEditBtn");
const cancelAccountEditBtn = document.getElementById("cancelAccountEditBtn");

// Transaction View: upcoming filters
const upcomingKindFilter = document.getElementById("upcomingKindFilter");
const upcomingStartDate = document.getElementById("upcomingStartDate");
const upcomingEndDate = document.getElementById("upcomingEndDate");
const upcomingSourceFilter = document.getElementById("upcomingSourceFilter");
const upcomingRecurrenceWrap = document.getElementById("upcomingRecurrenceWrap");
const upcomingRecurrenceFilter = document.getElementById("upcomingRecurrenceFilter");
const upcomingApplyBtn = document.getElementById("upcomingApplyBtn");

let upcomingFetchDebounce = null;
const variableTodoList = document.getElementById("variableTodoList");

// Expected transaction series id (unified edit modal)
const expectedEditId = document.getElementById("expectedEditId");
// These IDs existed in the older "series edit" panel; keep bindings so loaders can
// safely check them (they'll be null if not present).
const expectedEditAccountId = document.getElementById("expectedEditAccountId");
const expectedEditDelete = document.getElementById("expectedEditDelete");
let selectedExpectedSeriesTx = null;

// Expected delete choice modal
const expectedDeleteModal = document.getElementById("expectedDeleteModal");
const expectedDeleteErr = document.getElementById("expectedDeleteErr");
const expectedDeleteAllBtn = document.getElementById("expectedDeleteAllBtn");
const expectedDeleteThisBtn = document.getElementById("expectedDeleteThisBtn");
const expectedDeleteFutureBtn = document.getElementById("expectedDeleteFutureBtn");
const expectedDeleteCancelBtn = document.getElementById("expectedDeleteCancelBtn");
let expectedDeleteContext = { expectedId: null, occurrenceDate: null };

// Projection
const projectionStart = document.getElementById("projectionStart");
const runProjectionBtn = document.getElementById("runProjectionBtn");
const projectionSummary = document.getElementById("projectionSummary");
const projectionErr = document.getElementById("projectionErr");
const projectionDailyList = document.getElementById("projectionDailyList");

// Calendar
const calendarMonth = document.getElementById("calendarMonth");
const calendarMonthNum = document.getElementById("calendarMonthNum");
const calendarYear = document.getElementById("calendarYear");
const calendarPrevMonth = document.getElementById("calendarPrevMonth");
const calendarNextMonth = document.getElementById("calendarNextMonth");
const calendarGoToday = document.getElementById("calendarGoToday");
const calendarMode = document.getElementById("calendarMode");
const calendarErr = document.getElementById("calendarErr");
const calendarGrid = document.getElementById("calendarGrid");

// 5-year projection collapse
const PROJECTION_COLLAPSED_KEY = "familyCashFlow_projectionCollapsed";
function applyProjectionCollapsed(collapsed) {
  const panel = document.getElementById("projectionPanel");
  const btn = document.getElementById("projectionCollapseBtn");
  if (!panel || !btn) return;
  panel.classList.toggle("projection-panel--collapsed", collapsed);
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.title = collapsed ? "Expand projection" : "Collapse projection";
  try {
    localStorage.setItem(PROJECTION_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}
const projectionCollapseBtn = document.getElementById("projectionCollapseBtn");
if (projectionCollapseBtn) {
  projectionCollapseBtn.addEventListener("click", () => {
    const panel = document.getElementById("projectionPanel");
    if (!panel) return;
    applyProjectionCollapsed(!panel.classList.contains("projection-panel--collapsed"));
  });
  // Collapsed by default on first load
  const stored = localStorage.getItem(PROJECTION_COLLAPSED_KEY);
  applyProjectionCollapsed(stored !== "0");
}

// Chart
const chartStart = document.getElementById("chartStart");
const chartDaysRange = document.getElementById("chartDaysRange");
const chartDaysLabel = document.getElementById("chartDaysLabel");
const runProjectionChartBtn = document.getElementById("runProjectionChartBtn");
const chartErr = document.getElementById("chartErr");
const projectionChartCanvas = document.getElementById("projectionChartCanvas");

let projectionChartInstance = null;
let projectionChartDefaultsApplied = false;

// Expected instance editing (fields live inside unified #txEditModal)
const instanceExpectedTxId = document.getElementById("instanceExpectedTxId");
const instanceRecurrence = document.getElementById("instanceRecurrence");
const instanceTwiceMonthlyFields = document.getElementById("instanceTwiceMonthlyFields");
const instanceSecondDayOfMonth = document.getElementById("instanceSecondDayOfMonth");
const instanceAccountId = document.getElementById("instanceAccountId");
const seriesVariable = document.getElementById("seriesVariable");
const txEditRecurringUpdateBtn = document.getElementById("txEditRecurringUpdateBtn");

function updateInstanceTwiceMonthlyVisibility() {
  if (!instanceTwiceMonthlyFields || !instanceRecurrence) return;
  const on = instanceRecurrence.value === "twice_monthly";
  instanceTwiceMonthlyFields.style.display = on ? "block" : "none";
}

if (instanceRecurrence) {
  instanceRecurrence.addEventListener("change", updateInstanceTwiceMonthlyVisibility);
}

const txEditModal = document.getElementById("txEditModal");
const txEditInner = document.getElementById("txEditInner");
const txEditIntro = document.getElementById("txEditIntro");
const txEditId = document.getElementById("txEditId");
const txEditDate = document.getElementById("txEditDate");
const txEditKind = null;
const txEditAmount = document.getElementById("txEditAmount");
const txEditNotes = document.getElementById("txEditNotes");
const txEditErr = document.getElementById("txEditErr");
const txEditSave = document.getElementById("txEditSave");
const txEditDelete = document.getElementById("txEditDelete");
const txEditCancel = document.getElementById("txEditCancel");

if (txEditDate) {
  txEditDate.addEventListener("click", () => {
    try {
      if (typeof txEditDate.showPicker === "function") txEditDate.showPicker();
    } catch (_) {}
  });
  txEditDate.addEventListener("change", () => {
    if (transactionEditMode !== "recurring" || !selectedExpectedInstance) return;
    const iso = normalizeIsoDate(txEditDate.value);
    if (!iso) return;
    selectedExpectedMovedToDate = iso;
    show(txEditErr, "");
  });
}

// Reconcile day modal
const reconcileModal = document.getElementById("reconcileModal");
const reconcileErr = document.getElementById("reconcileErr");
const reconcileDateText = document.getElementById("reconcileDateText");
const reconcileChecked = document.getElementById("reconcileChecked");
const reconcileSaveBtn = document.getElementById("reconcileSaveBtn");
const reconcileCancelBtn = document.getElementById("reconcileCancelBtn");
let reconcileActiveDate = "";

// Add transaction modal (one-time or recurring from calendar)
const txAddModal = document.getElementById("txAddModal");
const txAddErr = document.getElementById("txAddErr");
const txAddDate = document.getElementById("txAddDate");
const txAddDateLabel = document.getElementById("txAddDateLabel");
const txAddAmount = document.getElementById("txAddAmount");
const txAddNotes = document.getElementById("txAddNotes");
const txAddRepeats = document.getElementById("txAddRepeats");
const txAddRecurringBlock = document.getElementById("txAddRecurringBlock");
const txAddRecurrence = document.getElementById("txAddRecurrence");
const txAddLastTxnDate = document.getElementById("txAddLastTxnDate");
const txAddTwiceMonthlyFields = document.getElementById("txAddTwiceMonthlyFields");
const txAddSecondDayOfMonth = document.getElementById("txAddSecondDayOfMonth");
const txAddAccountId = document.getElementById("txAddAccountId");
const txAddVariable = document.getElementById("txAddVariable");
const txAddSave = document.getElementById("txAddSave");
const txAddCancel = document.getElementById("txAddCancel");

function updateTxAddTwiceMonthlyVisibility() {
  if (!txAddTwiceMonthlyFields || !txAddRecurrence) return;
  const on = txAddRecurrence.value === "twice_monthly";
  txAddTwiceMonthlyFields.style.display = on ? "block" : "none";
}

function updateTxAddRepeatingUi() {
  const repeats = !!txAddRepeats?.checked;
  if (txAddRecurringBlock) txAddRecurringBlock.style.display = repeats ? "block" : "none";
  if (txAddDateLabel) txAddDateLabel.textContent = repeats ? "Start date" : "Date";
  const recWrap = document.getElementById("txAddRecurrenceWrap");
  if (recWrap) recWrap.hidden = !repeats;
  if (txAddRecurrence) txAddRecurrence.disabled = !repeats;
  const lastWrap = document.getElementById("txAddLastTxnFieldWrap");
  if (lastWrap) lastWrap.hidden = !repeats;
  if (txAddLastTxnDate) {
    if (!repeats) txAddLastTxnDate.value = "";
    txAddLastTxnDate.disabled = !repeats;
  }
  updateTxAddTwiceMonthlyVisibility();
}

if (txAddRepeats) {
  txAddRepeats.addEventListener("change", updateTxAddRepeatingUi);
}
if (txAddRecurrence) {
  txAddRecurrence.addEventListener("change", updateTxAddTwiceMonthlyVisibility);
}
updateTxAddRepeatingUi();

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", "POST");
  window.location.href = "./login.html";
});

function setLowBalanceResult(contentHtml, isEmpty = false) {
  if (!lowBalanceResult) return;
  lowBalanceResult.innerHTML = contentHtml || "";
  lowBalanceResult.classList.toggle("is-empty", !!isEmpty);
  lowBalanceResult.style.display = contentHtml ? "block" : "none";
}

async function refreshLowBalanceAlert() {
  try {
    show(lowBalanceErr, "");
    if (!lowBalanceResult) return;
    if (!state.activeFamilyId) {
      setSidebarLowBalanceBanner("", "off");
      setSidebarHighBalanceBanner("", "off");
      setSidebarBalanceThresholdHint("");
      setLowBalanceResult("", true);
      return;
    }

    const minRaw = balanceThresholdMin?.value?.trim() ?? "";
    const maxRaw = balanceThresholdMax?.value?.trim() ?? "";
    const minVal = minRaw === "" ? null : toNum(minRaw);
    const maxVal = maxRaw === "" ? null : toNum(maxRaw);
    const minOk = minVal != null && Number.isFinite(minVal);
    const maxOk = maxVal != null && Number.isFinite(maxVal);

    if (!minOk && !maxOk) {
      setSidebarLowBalanceBanner("", "off");
      setSidebarHighBalanceBanner("", "off");
      setLowBalanceResult(
        '<div class="k">Balance thresholds</div><div class="v">Enter a minimum and/or maximum to see projected alert dates.</div>',
        true
      );
      lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
      setSidebarBalanceThresholdHint(
        "Tip: open Settings → Balance thresholds and enter a minimum and/or maximum. Alerts will show here on Calendar view."
      );
      return;
    }

    const startIso = toISODate(new Date());
    const days = 1825;
    const mode = calendarMode?.value || "both";
    if (
      lowBalanceLastQuery.familyId === state.activeFamilyId &&
      lowBalanceLastQuery.min === minVal &&
      lowBalanceLastQuery.max === maxVal &&
      lowBalanceLastQuery.mode === mode
    ) {
      return;
    }
    lowBalanceLastQuery = { familyId: state.activeFamilyId, min: minVal, max: maxVal, mode };

    setLowBalanceResult('<div class="k">Balance thresholds</div><div class="v">Checking…</div>', true);

    let lowHit = null;
    if (minOk) {
      const data = await api(
        `/api/families/${state.activeFamilyId}/low-balance-first?threshold=${encodeURIComponent(String(minVal))}&start=${encodeURIComponent(
          startIso
        )}&days=${days}&mode=${encodeURIComponent(mode)}`,
        "GET"
      );
      lowHit = data?.hit_date ? { date: data.hit_date, balance: toNum(data.hit_balance) } : null;
    }

    let highHit = null;
    let highFetchErr = null;
    if (maxOk) {
      try {
        const dataHi = await api(
          `/api/families/${state.activeFamilyId}/high-balance-first?ceiling=${encodeURIComponent(String(maxVal))}&start=${encodeURIComponent(
            startIso
          )}&days=${days}&mode=${encodeURIComponent(mode)}`,
          "GET"
        );
        highHit = dataHi?.hit_date ? { date: dataHi.hit_date, balance: toNum(dataHi.hit_balance) } : null;
      } catch (err) {
        highFetchErr = err;
      }
    }

    const todayIso = toISODate(new Date());
    if (lowHit) {
      const lowIso = normalizeIsoDate(lowHit.date);
      if (lowIso && lowIso < todayIso) lowHit = null;
    }
    if (highHit) {
      const highIso = normalizeIsoDate(highHit.date);
      if (highIso && highIso < todayIso) highHit = null;
    }

    const parts = [];
    if (minOk) {
      if (!lowHit) {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≤ $${fmtMoneyThreshold(balanceThresholdMin?.value || "", minVal)}</div><div class="v">None in the next ${days} days.</div></div>`
        );
        setSidebarLowBalanceBanner(`Low (≤ $${fmtMoney(minVal)}): no crossing in the next ${days} days.`, "muted");
      } else {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≤ $${fmtMoneyThreshold(balanceThresholdMin?.value || "", minVal)}</div><div class="v danger">${fmtDateMDY(lowHit.date)} — $${fmtMoney(lowHit.balance)}</div></div>`
        );
        setSidebarLowBalanceBanner(`Next low balance: ${fmtDateMDY(lowHit.date)} — $${fmtMoney(lowHit.balance)}`, "danger");
      }
    }
    if (maxOk) {
      if (highFetchErr) {
        const msg = String(highFetchErr.message || "Request failed")
          .slice(0, 160)
          .replace(/</g, "");
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">Maximum threshold</div><div class="v danger">Could not check: ${msg}</div></div>`
        );
        setSidebarHighBalanceBanner("Maximum: server could not check (deploy latest API for high-balance).", "muted");
      } else if (!highHit) {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≥ $${fmtMoneyThreshold(balanceThresholdMax?.value || "", maxVal)}</div><div class="v">None in the next ${days} days.</div></div>`
        );
        setSidebarHighBalanceBanner(`High (≥ $${fmtMoney(maxVal)}): no crossing in the next ${days} days.`, "muted");
      } else {
        parts.push(
          `<div class="balance-threshold-result-block"><div class="k">First date ≥ $${fmtMoneyThreshold(balanceThresholdMax?.value || "", maxVal)}</div><div class="v">${fmtDateMDY(highHit.date)} — $${fmtMoney(highHit.balance)}</div></div>`
        );
        setSidebarHighBalanceBanner(`Next high balance: ${fmtDateMDY(highHit.date)} — $${fmtMoney(highHit.balance)}`, "high");
      }
    }

    const hasAlert = (minOk && lowHit) || (maxOk && highHit && !highFetchErr);
    setLowBalanceResult(parts.join(""), !hasAlert);
  } catch (e) {
    show(lowBalanceErr, e.message || "Failed to compute balance threshold alerts");
    setLowBalanceResult("", true);
    setSidebarLowBalanceBanner("", "off");
    setSidebarHighBalanceBanner("", "off");
    setSidebarBalanceThresholdHint("");
    lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
  }
}

function scheduleLowBalanceRefresh() {
  if (!balanceThresholdMin && !balanceThresholdMax) return;
  try {
    if (balanceThresholdMin) localStorage.setItem(BALANCE_THRESHOLD_MIN_KEY, balanceThresholdMin.value || "");
    if (balanceThresholdMax) localStorage.setItem(BALANCE_THRESHOLD_MAX_KEY, balanceThresholdMax.value || "");
  } catch (_) {}
  if (lowBalanceDebounceTimer) clearTimeout(lowBalanceDebounceTimer);
  lowBalanceDebounceTimer = setTimeout(() => refreshLowBalanceAlert(), 350);
}

function initCalendarYearOptions() {
  if (!calendarYear || calendarYear.dataset.populated === "1") return;
  calendarYear.dataset.populated = "1";
  for (let y = 2020; y <= 2030; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    calendarYear.appendChild(opt);
  }
}

function ensureCalendarYearOption(y) {
  if (!calendarYear) return;
  if (Number(y) < 2020 || Number(y) > 2030) return;
  const ys = String(y);
  if ([...calendarYear.options].some((o) => o.value === ys)) return;
  const opt = document.createElement("option");
  opt.value = ys;
  opt.textContent = ys;
  calendarYear.appendChild(opt);
  const opts = [...calendarYear.options].sort((a, b) => Number(a.value) - Number(b.value));
  calendarYear.innerHTML = "";
  for (const o of opts) calendarYear.appendChild(o);
}

function applyCalendarMonthToPickers(ym) {
  if (!ym || !calendarMonth) return;
  const p = String(ym).split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return;
  const ymStr = `${y}-${String(m).padStart(2, "0")}`;
  calendarMonth.value = ymStr;
  if (calendarMonthNum) calendarMonthNum.value = String(m);
  if (calendarYear) {
    ensureCalendarYearOption(y);
    calendarYear.value = String(y);
  }
}

async function onCalendarPickerChange() {
  if (!calendarMonth || !calendarMonthNum || !calendarYear) return;
  const y = calendarYear.value;
  const m = calendarMonthNum.value;
  const ym = `${y}-${String(Number(m)).padStart(2, "0")}`;
  calendarMonth.value = ym;
  if (monthInput) monthInput.value = ym;
  await loadMonthAndCalendar();
}

async function shiftCalendarMonth(delta) {
  const ym = (calendarMonth && calendarMonth.value) || (monthInput && monthInput.value);
  if (!ym) return;
  const p = String(ym).split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = new Date(y, m - 1 + delta, 1);
  const ny = d.getFullYear();
  const nm = d.getMonth() + 1;
  const next = `${ny}-${String(nm).padStart(2, "0")}`;
  applyCalendarMonthToPickers(next);
  if (monthInput) monthInput.value = next;
  await loadMonthAndCalendar();
}

document.getElementById("refreshBtn").addEventListener("click", async () => {
  applyCalendarMonthToPickers(monthInput.value);
  await loadMonthAndCalendar();
});

if (calendarMonthNum) {
  calendarMonthNum.addEventListener("change", () => onCalendarPickerChange());
}
if (calendarYear) {
  calendarYear.addEventListener("change", () => onCalendarPickerChange());
}
if (calendarPrevMonth) {
  calendarPrevMonth.addEventListener("click", () => shiftCalendarMonth(-1));
}
if (calendarNextMonth) {
  calendarNextMonth.addEventListener("click", () => shiftCalendarMonth(1));
}

if (calendarGoToday) {
  calendarGoToday.addEventListener("click", async () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    applyCalendarMonthToPickers(ym);
    if (monthInput) monthInput.value = ym;
    await loadMonthAndCalendar();
  });
}

// Calendar collapse removed: calendar is always visible.

const CHART_COLLAPSED_KEY = "familyCashFlow_chartCollapsed";

function applyChartCollapsed(collapsed) {
  const panel = document.getElementById("chartPanel");
  const btn = document.getElementById("chartCollapseBtn");
  if (!panel || !btn) return;
  panel.classList.toggle("chart-panel--collapsed", collapsed);
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.title = collapsed ? "Expand chart" : "Collapse chart";
  try {
    localStorage.setItem(CHART_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}

const chartCollapseBtn = document.getElementById("chartCollapseBtn");
if (chartCollapseBtn) {
  chartCollapseBtn.addEventListener("click", () => {
    const panel = document.getElementById("chartPanel");
    if (!panel) return;
    const wasCollapsed = panel.classList.contains("chart-panel--collapsed");
    applyChartCollapsed(!wasCollapsed);
    if (wasCollapsed && projectionChartInstance) {
      requestAnimationFrame(() => projectionChartInstance.resize());
    }
  });
  try {
    if (localStorage.getItem(CHART_COLLAPSED_KEY) === "1") applyChartCollapsed(true);
  } catch (_) {}
}

const SIDEBAR_SECTION_PREFIX = "familyCashFlow_sidebar_";

function applySidebarSectionCollapsed(card, collapsed) {
  const btn = card.querySelector(".sidebar-collapse-btn");
  const key = card.dataset.sidebarKey;
  if (!key || !btn) return;
  card.classList.toggle("sidebar-section--collapsed", collapsed);
  const label = (card.querySelector(".sidebar-section-head h2")?.textContent || "section").trim();
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.title = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  try {
    localStorage.setItem(SIDEBAR_SECTION_PREFIX + key, collapsed ? "1" : "0");
  } catch (_) {}
}

document.querySelectorAll(".sidebar-section[data-sidebar-key]").forEach((card) => {
  const btn = card.querySelector(".sidebar-collapse-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    applySidebarSectionCollapsed(card, !card.classList.contains("sidebar-section--collapsed"));
  });
  let stored = null;
  try {
    stored = localStorage.getItem(SIDEBAR_SECTION_PREFIX + card.dataset.sidebarKey);
  } catch (_) {}
  // Default behavior: collapsed unless explicitly stored as expanded ("0").
  // Low Balance Alert should be expanded by default unless the user has explicitly chosen otherwise.
  const key = card.dataset.sidebarKey;
  const userSetKey = SIDEBAR_SECTION_PREFIX + key + "_userSet";
  let userSet = false;
  try {
    userSet = localStorage.getItem(userSetKey) === "1";
  } catch (_) {}

  // If this is lowBalance and the user hasn't explicitly set a preference,
  // force expanded even if older localStorage had it collapsed.
  let collapsed;
  if ((key === "balanceThresholds" || key === "variableTodos" || key === "addTransaction") && !userSet) {
    collapsed = false;
    try {
      localStorage.setItem(SIDEBAR_SECTION_PREFIX + key, "0");
    } catch (_) {}
  } else {
    const defaultCollapsed = true;
    collapsed = stored == null ? defaultCollapsed : stored !== "0";
  }

  // Mark user-set preference once they toggle the section.
  btn.addEventListener("click", () => {
    try {
      localStorage.setItem(userSetKey, "1");
    } catch (_) {}
  });
  applySidebarSectionCollapsed(card, collapsed);
});

// Top navigation: Calendar View vs Transaction View.
const navCalendarView = document.getElementById("navCalendarView");
const navTransactionView = document.getElementById("navTransactionView");
const navSettingsView = document.getElementById("navSettingsView");
const navReportsView = document.getElementById("navReportsView");
const calendarViewPanel = document.getElementById("calendarViewPanel");
const transactionViewPanel = document.getElementById("transactionViewPanel");
const settingsViewPanel = document.getElementById("settingsViewPanel");
const reportsViewPanel = document.getElementById("reportsViewPanel");
const catReportStart = document.getElementById("catReportStart");
const catReportEnd = document.getElementById("catReportEnd");
const catReportYearSelect = document.getElementById("catReportYearSelect");
const catReportRunBtn = document.getElementById("catReportRunBtn");
const catReportErr = document.getElementById("catReportErr");
const catReportSummary = document.getElementById("catReportSummary");
const catReportTableWrap = document.getElementById("catReportTableWrap");
const catReportPreset30 = document.getElementById("catReportPreset30");
const catReportPresetYtd = document.getElementById("catReportPresetYtd");
const catReportPresetMonth = document.getElementById("catReportPresetMonth");
let catReportYearOptionsPopulated = false;

const ACTIVE_VIEW_KEY = "familyCashFlow_activeView";

function setActiveTopView(view) {
  const v =
    view === "transactions"
      ? "transactions"
      : view === "settings"
        ? "settings"
        : view === "reports"
          ? "reports"
          : "calendar";
  if (calendarViewPanel) calendarViewPanel.hidden = v !== "calendar";
  if (transactionViewPanel) transactionViewPanel.hidden = v !== "transactions";
  if (settingsViewPanel) settingsViewPanel.hidden = v !== "settings";
  if (reportsViewPanel) reportsViewPanel.hidden = v !== "reports";
  if (v === "transactions") {
    void loadUpcomingTransactionsPanel();
  }
  if (navCalendarView) {
    navCalendarView.classList.toggle("is-active", v === "calendar");
    navCalendarView.setAttribute("aria-selected", v === "calendar" ? "true" : "false");
  }
  if (navTransactionView) {
    navTransactionView.classList.toggle("is-active", v === "transactions");
    navTransactionView.setAttribute("aria-selected", v === "transactions" ? "true" : "false");
  }
  if (navSettingsView) {
    navSettingsView.classList.toggle("is-active", v === "settings");
    navSettingsView.setAttribute("aria-selected", v === "settings" ? "true" : "false");
  }
  if (navReportsView) {
    navReportsView.classList.toggle("is-active", v === "reports");
    navReportsView.setAttribute("aria-selected", v === "reports" ? "true" : "false");
  }
  if (v === "reports") {
    populateCatReportYearSelect();
    ensureCatReportDateDefaults();
  }
  if (v === "calendar") {
    lowBalanceLastQuery = { familyId: null, min: null, max: null, mode: null };
    void refreshLowBalanceAlert();
  }
  try {
    localStorage.setItem(ACTIVE_VIEW_KEY, v);
  } catch (_) {}
}

if (navCalendarView) {
  navCalendarView.addEventListener("click", () => setActiveTopView("calendar"));
}
if (navTransactionView) {
  navTransactionView.addEventListener("click", () => setActiveTopView("transactions"));
}
if (navSettingsView) {
  navSettingsView.addEventListener("click", () => setActiveTopView("settings"));
}
if (navReportsView) {
  navReportsView.addEventListener("click", () => setActiveTopView("reports"));
}

function populateCatReportYearSelect() {
  if (!catReportYearSelect || catReportYearOptionsPopulated) return;
  catReportYearOptionsPopulated = true;
  const y0 = new Date().getFullYear();
  for (let yr = y0 - 6; yr <= y0 + 3; yr++) {
    const o = document.createElement("option");
    o.value = String(yr);
    o.textContent = String(yr);
    catReportYearSelect.appendChild(o);
  }
}

function ensureCatReportDateDefaults() {
  if (!catReportStart || !catReportEnd) return;
  if (catReportStart.value || catReportEnd.value) return;
  const t = new Date();
  const y = t.getFullYear();
  catReportStart.value = `${y}-01-01`;
  catReportEnd.value = toISODate(t);
}

function setCatReportRange(startIso, endIso) {
  if (catReportStart) catReportStart.value = startIso;
  if (catReportEnd) catReportEnd.value = endIso;
}

function applyCatReportPreset(preset) {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  if (preset === "30") {
    const end = toISODate(t);
    const s = new Date(t);
    s.setDate(s.getDate() - 29);
    setCatReportRange(toISODate(s), end);
  } else if (preset === "ytd") {
    setCatReportRange(`${y}-01-01`, toISODate(t));
  } else if (preset === "month") {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    setCatReportRange(toISODate(start), toISODate(end));
  }
  if (catReportYearSelect) catReportYearSelect.value = "";
}

function nMoney(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function renderCategoryTotalsReport(data) {
  if (!catReportTableWrap) return;
  const mode = data.mode || "actual";
  const showEst = mode === "actual_plus_estimated";
  const asOf = data.as_of ? fmtDateMDY(data.as_of) : "—";
  if (catReportSummary) {
    const rangeTxt = `${fmtDateMDY(data.start_date)} – ${fmtDateMDY(data.end_date)}`;
    catReportSummary.style.display = "block";
    catReportSummary.textContent = `${rangeTxt} · Split at ${asOf} (UTC) for estimates · Mode: ${showEst ? "actual + future estimates" : "actual only"}`;
  }

  const lines = data.lines || [];
  if (lines.length === 0) {
    catReportTableWrap.innerHTML = '<p class="meta">No category activity in this range.</p>';
    return;
  }

  const thEst = showEst
    ? '<th class="num cat-report-est">Income (est.)</th><th class="num cat-report-est">Expense (est.)</th>'
    : "";
  const rows = lines
    .map((ln) => {
      const estCells = showEst
        ? `<td class="num cat-report-est">${fmtMoney(nMoney(ln.income_estimated))}</td><td class="num cat-report-est">${fmtMoney(nMoney(ln.expense_estimated))}</td>`
        : "";
      const name = String(ln.category_name || "Select Category");
      return `<tr><td>${escapeHtml(name)}</td><td class="num">${fmtMoney(nMoney(ln.income_actual))}</td><td class="num">${fmtMoney(nMoney(ln.expense_actual))}</td>${estCells}</tr>`;
    })
    .join("");

  const footEst = showEst
    ? `<td class="num cat-report-est">${fmtMoney(nMoney(data.sum_income_estimated))}</td><td class="num cat-report-est">${fmtMoney(nMoney(data.sum_expense_estimated))}</td>`
    : "";

  catReportTableWrap.innerHTML = `
    <table class="category-report-table">
      <thead><tr>
        <th>Category</th>
        <th class="num">Income (actual)</th>
        <th class="num">Expense (actual)</th>
        ${thEst}
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td>Total</td>
        <td class="num">${fmtMoney(nMoney(data.sum_income_actual))}</td>
        <td class="num">${fmtMoney(nMoney(data.sum_expense_actual))}</td>
        ${footEst}
      </tr></tfoot>
    </table>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadCategoryTotalsReport() {
  show(catReportErr, "");
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!catReportStart?.value || !catReportEnd?.value) throw new Error("Start and end dates are required");
  const mode = getRadioValue("catReportMode", "actual");
  const q = new URLSearchParams({
    start_date: catReportStart.value,
    end_date: catReportEnd.value,
    mode,
  });
  const data = await api(`/api/families/${state.activeFamilyId}/reports/category-totals?${q.toString()}`, "GET");
  renderCategoryTotalsReport(data);
}

if (catReportPreset30) {
  catReportPreset30.addEventListener("click", () => {
    applyCatReportPreset("30");
  });
}
if (catReportPresetYtd) {
  catReportPresetYtd.addEventListener("click", () => {
    applyCatReportPreset("ytd");
  });
}
if (catReportPresetMonth) {
  catReportPresetMonth.addEventListener("click", () => {
    applyCatReportPreset("month");
  });
}
if (catReportYearSelect) {
  catReportYearSelect.addEventListener("change", () => {
    const yr = catReportYearSelect.value;
    if (!yr) return;
    setCatReportRange(`${yr}-01-01`, `${yr}-12-31`);
  });
}
if (catReportRunBtn) {
  catReportRunBtn.addEventListener("click", async () => {
    try {
      await loadCategoryTotalsReport();
    } catch (e) {
      show(catReportErr, e.message || "Failed to load report");
      if (catReportTableWrap) catReportTableWrap.innerHTML = "";
      if (catReportSummary) catReportSummary.style.display = "none";
    }
  });
}

try {
  const storedView = localStorage.getItem(ACTIVE_VIEW_KEY);
  if (storedView) setActiveTopView(storedView);
} catch (_) {}

if (calendarMode) {
  calendarMode.addEventListener("change", async () => {
    await loadCalendarMonthDaily();
    renderCalendar();
    renderMonthSummaryTotalsFromState();
    await refreshLowBalanceAlert();
  });
}

familySelect.addEventListener("change", async () => {
  state.activeFamilyId = Number(familySelect.value);
  await loadCategories();
  await loadAccounts();
  await loadExpectedTransactions();
  await loadMonthAndCalendar();
});

/** Series / transaction label on the server (add form has no separate Label field). */
function descriptionForNewTransaction(categoryId, opts = {}) {
  const recurring = !!opts.recurring;
  const cid = categoryId != null ? Number(categoryId) : NaN;
  if (Number.isFinite(cid) && (state.categories || []).length) {
    const c = (state.categories || []).find((x) => Number(x.id) === cid);
    if (c?.name && String(c.name).trim()) return String(c.name).trim().slice(0, 500);
  }
  return recurring ? "Scheduled" : "";
}

document.getElementById("addCategoryBtn").addEventListener("click", async () => {
  try {
    show(catErr, "");
    const name = document.getElementById("newCategoryName").value.trim();
    if (!name) throw new Error("Category name is required");
    await api(`/api/families/${state.activeFamilyId}/categories`, "POST", { name });
    document.getElementById("newCategoryName").value = "";
    await loadCategories();
  } catch (e) {
    show(catErr, e.message || "Failed to add category");
  }
});

if (txAddSave) {
  txAddSave.addEventListener("click", async () => {
    try {
      show(txAddErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");

      const dateVal = txAddDate?.value || "";
      const notesRaw = txAddNotes?.value?.trim() || "";
      const kind = getRadioValue("txAddKind", "expense");
      const amountVal = txAddAmount?.value || "";
      const categoryId = categoryIdFromCategoryField("txAddCategoryId");
      const repeats = !!txAddRepeats?.checked;
      const desc = descriptionForNewTransaction(categoryId, { recurring: repeats });

      if (!dateVal) throw new Error(repeats ? "Start date is required" : "Date is required");
      if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");

      if (repeats) {
        const recurrenceVal = txAddRecurrence?.value || "monthly";
        const accountIdVal = txAddAccountId?.value || "";
        if (!accountIdVal) throw new Error("Account is required");

        const lastTxnVal = txAddLastTxnDate && txAddLastTxnDate.value ? txAddLastTxnDate.value : null;
        if (lastTxnVal && lastTxnVal < dateVal) {
          throw new Error("Last transaction date cannot be before start date");
        }

        let secondDayOfMonth = null;
        if (recurrenceVal === "twice_monthly") {
          const raw = txAddSecondDayOfMonth && txAddSecondDayOfMonth.value;
          const n = raw !== "" && raw != null ? Number(raw) : NaN;
          if (!Number.isFinite(n) || n < 1 || n > 31) {
            throw new Error("2nd day of month (1–31) is required for twice monthly");
          }
          const startDay = Number(dateVal.slice(8, 10));
          if (n === startDay) {
            throw new Error("2nd day of month must differ from the start date’s day of month");
          }
          secondDayOfMonth = n;
        }

        await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "POST", {
          account_id: Number(accountIdVal),
          start_date: dateVal,
          end_date: lastTxnVal,
          recurrence: recurrenceVal,
          second_day_of_month: secondDayOfMonth,
          description: desc,
          notes: notesRaw || null,
          kind,
          amount: Number(amountVal),
          variable: !!(txAddVariable && txAddVariable.checked),
          category_id: categoryId,
        });

        closeTxAddModal();
        await refreshExpectedCalendarAndMonth();
        return;
      }

      await api(`/api/families/${state.activeFamilyId}/transactions`, "POST", {
        date: dateVal,
        description: desc,
        notes: notesRaw || null,
        kind,
        amount: Number(amountVal),
        category_id: categoryId,
        reimbursable: false,
      });

      closeTxAddModal();
      await loadMonthAndCalendar();
    } catch (e) {
      show(txAddErr, e.message || "Failed to add");
    }
  });
}

addAccountBtn.addEventListener("click", async () => {
  try {
    show(accErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");

    const name = accountName.value.trim();
    const type = accountType.value;
    const startingBalanceVal = accountStartingBalance.value;
    const startingBalanceDateVal = accountStartingBalanceDate.value;

    if (!name) throw new Error("Account name is required");
    if (startingBalanceVal === "" || Number.isNaN(Number(startingBalanceVal))) throw new Error("Starting balance is required");
    if (!startingBalanceDateVal) throw new Error("Starting balance date is required");

    await api(`/api/families/${state.activeFamilyId}/accounts`, "POST", {
      name,
      type,
      starting_balance: Number(startingBalanceVal),
      starting_balance_date: startingBalanceDateVal,
    });

    clearAccountEdit();
    await loadAccounts();
    await loadMonthAndCalendar();
  } catch (e) {
    show(accErr, e.message || "Failed to add account");
  }
});

saveAccountEditBtn.addEventListener("click", async () => {
  try {
    show(accErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    if (!accountEditId.value) throw new Error("Select an account to edit first");
    const startingBalanceVal = accountStartingBalance.value;
    const startingBalanceDateVal = accountStartingBalanceDate.value;
    if (startingBalanceVal === "" || Number.isNaN(Number(startingBalanceVal))) throw new Error("Starting balance is required");
    if (!startingBalanceDateVal) throw new Error("Starting balance date is required");
    await api(`/api/families/${state.activeFamilyId}/accounts/${accountEditId.value}`, "PUT", {
      starting_balance: Number(startingBalanceVal),
      starting_balance_date: startingBalanceDateVal,
    });
    clearAccountEdit();
    await loadAccounts();
    await loadMonthAndCalendar();
  } catch (e) {
    show(accErr, e.message || "Failed to update account");
  }
});

cancelAccountEditBtn.addEventListener("click", () => {
  clearAccountEdit();
});

function renderTxEditCategoryOptions() {
  syncCategoryComboboxCategories("txEditCategoryId", state.categories || []);
}

function applyTransactionEditMode(mode, opts = {}) {
  if (opts.resetting) {
    transactionEditMode = "actual";
    if (txEditInner) txEditInner.classList.remove("modal--expected-edit");
    const modeBanner = document.getElementById("txEditModeBanner");
    if (modeBanner) {
      modeBanner.style.display = "none";
      modeBanner.textContent = "";
    }
    const txEditTopStrip = document.querySelector("#txEditModal .tx-edit-top");
    if (txEditTopStrip) txEditTopStrip.style.display = "";
    if (instanceRecurrence) instanceRecurrence.disabled = false;
    if (instanceAccountId) instanceAccountId.disabled = false;
    if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.disabled = false;
    const saveRow = document.getElementById("txEditSaveRow");
    if (saveRow) saveRow.style.display = "";
    const txEditDel = document.getElementById("txEditDelete");
    if (txEditDel) txEditDel.style.display = "";
    return;
  }

  transactionEditMode = mode;
  const recurring = mode === "recurring";
  if (txEditInner) txEditInner.classList.add("modal--expected-edit");

  const title = document.getElementById("txEditTitle");
  if (title) {
    title.classList.add("sr-only");
    title.textContent = recurring ? "Recurring transaction" : "Edit transaction";
  }
  const modeBanner = document.getElementById("txEditModeBanner");
  if (modeBanner) {
    modeBanner.style.display = "block";
    modeBanner.textContent = recurring ? "Recurring transaction" : "Transaction";
  }
  const txEditTopStrip = document.querySelector("#txEditModal .tx-edit-top");
  if (txEditTopStrip) txEditTopStrip.style.display = "";

  const notesLabel = document.getElementById("txEditNotesLabel");
  if (notesLabel) notesLabel.textContent = recurring ? "Notes (series)" : "Notes";
  const dateLabel = document.getElementById("txEditDateLabel");
  if (dateLabel) dateLabel.textContent = recurring ? "Occurrence date" : "Date";

  const wrapSch = document.getElementById("txEditRecurringScheduleWrap");
  if (wrapSch) {
    wrapSch.style.display = "block";
    wrapSch.classList.toggle("tx-edit-schedule--locked", !recurring);
  }
  if (instanceRecurrence) {
    if (!recurring) {
      instanceRecurrence.value = "once";
      instanceRecurrence.disabled = true;
      instanceRecurrence.title = "Bank transactions do not repeat. Stored as a single dated entry.";
    } else {
      instanceRecurrence.disabled = false;
      instanceRecurrence.title = "How often this repeats";
    }
  }
  if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.disabled = !recurring;

  const acctCol = document.getElementById("txEditAccountCol");
  if (acctCol) acctCol.style.display = "block";
  const acctCatRow = document.getElementById("txEditAccountCategoryRow");
  if (acctCatRow) acctCatRow.classList.add("tx-edit-account-category-row--recurring");
  if (instanceAccountId) {
    instanceAccountId.disabled = !recurring;
    instanceAccountId.title = recurring
      ? ""
      : "Actual transactions are not tied to an account in the ledger; this is display-only.";
  }

  updateInstanceTwiceMonthlyVisibility();

  const varWrap = document.getElementById("txEditRecurringVariableWrap");
  if (varWrap) varWrap.style.display = recurring ? "block" : "none";

  const prim = document.getElementById("txEditRecurringPrimaryActions");
  if (prim) prim.style.display = "none";

  const saveRow = document.getElementById("txEditSaveRow");
  if (saveRow) saveRow.style.display = "";
  if (txEditSave) txEditSave.style.display = recurring ? "none" : "";
  if (txEditRecurringUpdateBtn) txEditRecurringUpdateBtn.style.display = recurring ? "" : "none";
  const txEditDel = document.getElementById("txEditDelete");
  if (txEditDel) txEditDel.style.display = "";

  if (txEditCancel) {
    txEditCancel.textContent = recurring ? "Close" : "Cancel";
    txEditCancel.classList.toggle("tx-edit-dismiss--close", recurring);
  }

  const notesRowEl = document.getElementById("txEditNotesRow");
  const varWrapEl = document.getElementById("txEditRecurringVariableWrap");
  if (notesRowEl && varWrapEl && varWrapEl.parentNode) {
    varWrapEl.parentNode.insertBefore(notesRowEl, varWrapEl);
    notesRowEl.classList.add("tx-edit-notes-row--in-panel");
  }
}

function openTxEditModal(tx) {
  if (!txEditModal || !txEditId || !txEditDate) return;
  selectedExpectedInstance = null;
  selectedExpectedMovedToDate = null;
  if (expectedEditId) expectedEditId.value = "";
  if (instanceExpectedTxId) instanceExpectedTxId.value = "";
  txEditId.value = String(tx.id);
  txEditDate.value = tx.date;
  {
    const k = tx && tx.kind ? String(tx.kind) : "expense";
    const radio = document.querySelector(`input[type="radio"][name="txEditKind"][value="${k}"]`);
    if (radio) radio.checked = true;
  }
  txEditAmount.value = tx.amount;
  txEditDescriptionSnapshot = String(tx.description || "").trim().slice(0, 500);
  if (txEditNotes) txEditNotes.value = tx.notes || "";
  txEditReimbursableValue = !!tx.reimbursable;
  renderTxEditCategoryOptions();
  setCategoryFieldValue("txEditCategoryId", tx.category_id);
  if (instanceAccountId && state.accounts && state.accounts.length > 0) {
    instanceAccountId.value = String(state.accounts[0].id);
  }
  show(txEditErr, "");
  txEditModal.classList.add("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "false");
  applyTransactionEditMode("actual");
}

function closeTxEditApplyScopeModal() {
  const m = document.getElementById("txEditApplyScopeModal");
  if (!m) return;
  m.classList.remove("modal-overlay--open");
  m.setAttribute("aria-hidden", "true");
  show(document.getElementById("txEditApplyScopeErr"), "");
}

function closeTxEditDeleteScopeModal() {
  const m = document.getElementById("txEditDeleteScopeModal");
  if (!m) return;
  m.classList.remove("modal-overlay--open");
  m.setAttribute("aria-hidden", "true");
  show(document.getElementById("txEditDeleteScopeErr"), "");
}

function openTxEditApplyScopeModal() {
  closeTxEditDeleteScopeModal();
  const m = document.getElementById("txEditApplyScopeModal");
  if (!m) return;
  show(document.getElementById("txEditApplyScopeErr"), "");
  m.classList.add("modal-overlay--open");
  m.setAttribute("aria-hidden", "false");
}

function openTxEditDeleteScopeModal() {
  closeTxEditApplyScopeModal();
  const m = document.getElementById("txEditDeleteScopeModal");
  if (!m) return;
  show(document.getElementById("txEditDeleteScopeErr"), "");
  m.classList.add("modal-overlay--open");
  m.setAttribute("aria-hidden", "false");
}

function closeTxEditModal() {
  if (!txEditModal) return;
  closeTxEditApplyScopeModal();
  closeTxEditDeleteScopeModal();
  txEditModal.classList.remove("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "true");
  selectedExpectedInstance = null;
  selectedExpectedMovedToDate = null;
  if (txEditDate) {
    txEditDate.value = "";
    txEditDate.disabled = false;
    txEditDate.readOnly = false;
  }
  if (instanceExpectedTxId) instanceExpectedTxId.value = "";
  if (expectedEditId) expectedEditId.value = "";
  applyTransactionEditMode("actual", { resetting: true });
}

function mountTxAddFormInModal() {
  const root = document.getElementById("txAddFormRoot");
  const mount = document.getElementById("txAddModalFormMount");
  if (root && mount && root.parentElement !== mount) mount.appendChild(root);
}

function mountTxAddFormInSidebar() {
  const root = document.getElementById("txAddFormRoot");
  const home = document.getElementById("txAddFormHome");
  if (root && home && root.parentElement !== home) home.appendChild(root);
}

function openTxAddModal(opts = {}) {
  if (!txAddModal || !txAddDate) return;
  mountTxAddFormInModal();
  const dateVal = opts.date || "";
  txAddDate.value = dateVal;
  if (txAddAmount) txAddAmount.value = "";
  if (txAddNotes) txAddNotes.value = "";
  setCategoryFieldValue("txAddCategoryId", null);
  if (txAddRepeats) txAddRepeats.checked = !!opts.repeats;
  if (txAddRecurrence) txAddRecurrence.value = "monthly";
  if (txAddLastTxnDate) txAddLastTxnDate.value = "";
  if (txAddSecondDayOfMonth) txAddSecondDayOfMonth.value = "";
  if (txAddVariable) txAddVariable.checked = false;
  if (txAddAccountId) {
    renderAccountSelect(txAddAccountId, state.accounts || []);
    if (state.accounts && state.accounts.length > 0) txAddAccountId.value = String(state.accounts[0].id);
  }
  updateTxAddRepeatingUi();
  const kind = opts.kind || "expense";
  const radio = document.querySelector(`input[type="radio"][name="txAddKind"][value="${kind}"]`);
  if (radio) radio.checked = true;
  show(txAddErr, "");
  txAddModal.classList.add("modal-overlay--open");
  txAddModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => (txAddAmount ? txAddAmount.focus() : txAddDate.focus()));
}

function closeTxAddModal() {
  if (!txAddModal) return;
  txAddModal.classList.remove("modal-overlay--open");
  txAddModal.setAttribute("aria-hidden", "true");
  mountTxAddFormInSidebar();
}

function openReconcileModal(iso) {
  if (!reconcileModal) return;
  reconcileActiveDate = normalizeIsoDate(iso) || iso;
  if (reconcileDateText) reconcileDateText.textContent = reconcileActiveDate ? fmtDateMDY(reconcileActiveDate) : "—";
  if (reconcileChecked) reconcileChecked.checked = state.reconciledDates?.has(reconcileActiveDate) || false;
  show(reconcileErr, "");
  reconcileModal.classList.add("modal-overlay--open");
  reconcileModal.setAttribute("aria-hidden", "false");
}

function closeReconcileModal() {
  if (!reconcileModal) return;
  reconcileModal.classList.remove("modal-overlay--open");
  reconcileModal.setAttribute("aria-hidden", "true");
  reconcileActiveDate = "";
}

if (txEditSave) {
  txEditSave.addEventListener("click", async () => {
    try {
      if (transactionEditMode === "recurring") return;
      show(txEditErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const id = txEditId.value;
      if (!id) throw new Error("No transaction selected");
      const amountVal = txEditAmount.value;
      if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");
      await api(`/api/families/${state.activeFamilyId}/transactions/${id}`, "PUT", {
        date: txEditDate.value,
        kind: getRadioValue("txEditKind", "expense"),
        amount: Number(amountVal),
        description: txEditDescriptionSnapshot,
        notes: txEditNotes && txEditNotes.value.trim() ? txEditNotes.value.trim() : null,
        category_id: categoryIdFromCategoryField("txEditCategoryId"),
        reimbursable: txEditReimbursableValue,
      });
      closeTxEditModal();
      await loadMonthAndCalendar();
    } catch (e) {
      show(txEditErr, e.message || "Failed to save");
    }
  });
}

if (txEditDelete) {
  txEditDelete.addEventListener("click", async () => {
    try {
      if (transactionEditMode === "recurring") {
        show(txEditErr, "");
        const pre = validateTxEditBeforeRecurringDelete();
        if (pre) {
          show(txEditErr, pre);
          return;
        }
        openTxEditDeleteScopeModal();
        return;
      }
      show(txEditErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const id = txEditId.value;
      if (!id) throw new Error("No transaction selected");
      if (!confirm("Delete this transaction?")) return;
      await api(`/api/families/${state.activeFamilyId}/transactions/${id}`, "DELETE");
      closeTxEditModal();
      await loadMonthAndCalendar();
    } catch (e) {
      show(txEditErr, e.message || "Failed to delete");
    }
  });
}

if (txEditCancel) {
  txEditCancel.addEventListener("click", () => closeTxEditModal());
}

if (txEditModal) {
  txEditModal.addEventListener("click", (e) => {
    if (e.target === txEditModal) closeTxEditModal();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const deleteScope = document.getElementById("txEditDeleteScopeModal");
  if (deleteScope?.classList.contains("modal-overlay--open")) {
    closeTxEditDeleteScopeModal();
    return;
  }
  const scope = document.getElementById("txEditApplyScopeModal");
  if (scope?.classList.contains("modal-overlay--open")) {
    closeTxEditApplyScopeModal();
    return;
  }
  if (txEditModal?.classList.contains("modal-overlay--open")) closeTxEditModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && txAddModal?.classList.contains("modal-overlay--open")) closeTxAddModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && expectedDeleteModal?.classList.contains("modal-overlay--open")) closeExpectedDeleteModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reconcileModal?.classList.contains("modal-overlay--open")) closeReconcileModal();
});

if (txAddCancel) {
  txAddCancel.addEventListener("click", () => closeTxAddModal());
}
if (txAddModal) {
  txAddModal.addEventListener("click", (e) => {
    if (e.target === txAddModal) closeTxAddModal();
  });
}

if (reconcileCancelBtn) {
  reconcileCancelBtn.addEventListener("click", () => closeReconcileModal());
}
if (reconcileModal) {
  reconcileModal.addEventListener("click", (e) => {
    if (e.target === reconcileModal) closeReconcileModal();
  });
}

if (calendarGrid) {
  calendarGrid.addEventListener("click", (e) => {
    // Click on an actual transaction line opens the edit modal.
    const part = e.target.closest(".cal-tx-part");
    if (part && calendarGrid.contains(part)) {
      const id = Number(part.dataset.txId);
      if (!id) return;
      const tx = (state.monthActualItems || []).find((t) => Number(t.id) === id);
      if (tx) openTxEditModal(tx);
      return;
    }

    // Click on an empty part of a day cell opens the add transaction modal.
    // (Expected tx lines stopPropagation in their own handler.)
    const cell = e.target.closest(".cal-cell");
    if (!cell || !calendarGrid.contains(cell)) return;
    const iso = cell.dataset.iso;
    if (!iso) return;
    openTxAddModal({ date: iso });
  });
}

// (Transaction View) recurring filter panel removed; upcoming filters replace it.
function syncUpcomingRecurrenceVisibility() {
  const srcSel = upcomingSourceFilter ? String(upcomingSourceFilter.value || "all") : "all";
  const show = srcSel === "recurring";
  if (upcomingRecurrenceWrap) upcomingRecurrenceWrap.style.display = show ? "" : "none";
  if (upcomingRecurrenceFilter) upcomingRecurrenceFilter.disabled = !show;
}

function initUpcomingDateDefaultsIfEmpty() {
  if (!upcomingStartDate || !upcomingEndDate) return;
  if (upcomingStartDate.value || upcomingEndDate.value) return;
  const todayIso = toISODate(new Date());
  const endCap = new Date();
  endCap.setDate(endCap.getDate() + 548);
  upcomingStartDate.value = todayIso;
  upcomingEndDate.value = toISODate(endCap);
}

function scheduleUpcomingRefetchAndRender() {
  if (upcomingFetchDebounce) clearTimeout(upcomingFetchDebounce);
  upcomingFetchDebounce = setTimeout(() => {
    upcomingFetchDebounce = null;
    void loadUpcomingTransactionsPanel();
    renderUpcomingTransactionsFiltered();
  }, 250);
}

function scheduleUpcomingRenderOnly() {
  if (upcomingFetchDebounce) clearTimeout(upcomingFetchDebounce);
  upcomingFetchDebounce = setTimeout(() => {
    upcomingFetchDebounce = null;
    renderUpcomingTransactionsFiltered();
  }, 120);
}

initUpcomingDateDefaultsIfEmpty();
syncUpcomingRecurrenceVisibility();

if (upcomingApplyBtn) upcomingApplyBtn.addEventListener("click", () => scheduleUpcomingRefetchAndRender());
if (upcomingKindFilter) upcomingKindFilter.addEventListener("change", () => scheduleUpcomingRenderOnly());
if (upcomingSourceFilter) upcomingSourceFilter.addEventListener("change", () => { syncUpcomingRecurrenceVisibility(); scheduleUpcomingRenderOnly(); });
if (upcomingRecurrenceFilter) upcomingRecurrenceFilter.addEventListener("change", () => scheduleUpcomingRenderOnly());
if (upcomingStartDate) upcomingStartDate.addEventListener("change", () => scheduleUpcomingRefetchAndRender());
if (upcomingEndDate) upcomingEndDate.addEventListener("change", () => scheduleUpcomingRefetchAndRender());

runProjectionBtn.addEventListener("click", async () => {
  try {
    show(projectionErr, "");
    projectionSummary.innerHTML = "";
    projectionDailyList.innerHTML = "";

    if (!state.activeFamilyId) throw new Error("Choose a family first");

    const startVal = projectionStart.value;
    if (!startVal) throw new Error("Projection start date is required");

    const summary = await api(
      `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(startVal)}&days=1825&include_accounts=false`,
      "GET"
    );

    renderProjectionSummary(summary);

    const dailyShort = await api(
      `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(startVal)}&days=90&include_accounts=true`,
      "GET"
    );

    renderProjectionDaily(dailyShort?.daily || []);
  } catch (e) {
    show(projectionErr, e.message || "Failed to run projection");
  }
});

if (chartDaysRange && chartDaysLabel) {
  chartDaysRange.addEventListener("input", () => {
    chartDaysLabel.textContent = `${chartDaysRange.value} days`;
    document.querySelectorAll(".chart-duration-btn").forEach((b) => b.classList.remove("is-active"));
  });
}

function getYtdDaysFromChartStart() {
  if (!chartStart?.value) return 365;
  const s = new Date(`${chartStart.value}T12:00:00`);
  if (Number.isNaN(s.getTime())) return 365;
  const y = s.getFullYear();
  const end = new Date(y, 11, 31);
  const days = Math.floor((end - s) / 864e5) + 1;
  return Math.max(1, Math.min(4000, days));
}

function daysForPreset(preset) {
  const map = {
    "1D": 1,
    "5D": 5,
    "1M": 30,
    "6M": 183,
    "1Y": 365,
    "5Y": 1825,
    "MAX": 4000,
  };
  if (preset === "YTD") return getYtdDaysFromChartStart();
  return map[preset] ?? 365;
}

function formatProjectionAxisDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatProjectionTooltipDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ensureProjectionChartDefaults() {
  if (projectionChartDefaultsApplied || typeof Chart === "undefined") return;
  projectionChartDefaultsApplied = true;
  Chart.defaults.color = "#4b5563";
  Chart.defaults.borderColor = "rgba(0,0,0,0.10)";
  Chart.defaults.font.family =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  Chart.defaults.font.size = 11;
}

async function refreshProjectionChart() {
  show(chartErr, "");
  if (projectionChartCanvas) projectionChartCanvas.dataset.status = "";
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!chartStart?.value) throw new Error("Chart start date is required");
  const daysVal = Number(chartDaysRange.value);
  if (!Number.isFinite(daysVal) || daysVal < 1 || daysVal > 4000) {
    throw new Error("Horizon must be between 1 and 4000 days");
  }
  const summary = await api(
    `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(chartStart.value)}&days=${daysVal}&include_accounts=false`,
    "GET"
  );
  drawProjectionChart(summary?.daily || []);
}

runProjectionChartBtn.addEventListener("click", async () => {
  try {
    document.querySelectorAll(".chart-duration-btn").forEach((b) => b.classList.remove("is-active"));
    await refreshProjectionChart();
  } catch (e) {
    show(chartErr, e.message || "Failed to update chart");
  }
});

document.querySelector(".chart-duration-bar")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".chart-duration-btn");
  if (!btn) return;
  try {
    const preset = btn.dataset.preset;
    if (!preset) return;
    const d = daysForPreset(preset);
    chartDaysRange.value = String(d);
    if (chartDaysLabel) chartDaysLabel.textContent = `${d} days`;
    document.querySelectorAll(".chart-duration-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    await refreshProjectionChart();
  } catch (err) {
    show(chartErr, err.message || "Failed to update chart");
  }
});

function validateTxEditBeforeRecurringApply() {
  if (!state.activeFamilyId) return "Choose a family first";
  if (!selectedExpectedInstance) return "Select an occurrence from the calendar for this series.";
  const amountVal = txEditAmount?.value;
  const amount = amountVal ? Number(amountVal) : null;
  if (!amount || Number.isNaN(amount) || amount <= 0) return "Amount must be > 0";
  if (!instanceAccountId?.value) return "Account is required";
  return null;
}

function validateTxEditBeforeRecurringDelete() {
  if (!state.activeFamilyId) return "Choose a family first";
  if (!selectedExpectedInstance) return "Select an occurrence from the calendar for this series.";
  return null;
}

async function deleteExpectedThisOccurrenceOnlyFromModal() {
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");
  const cancelOcc = normalizeIsoDate(selectedExpectedInstance.occurrence_date) || selectedExpectedInstance.occurrence_date;
  await api(
    `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${cancelOcc}`,
    "POST",
    { action: "cancel" }
  );
  closeTxEditDeleteScopeModal();
  closeTxEditModal();
  await refreshExpectedCalendarAndMonth();
}

async function deleteExpectedThisAndFutureFromModal() {
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");
  const meta = getExpectedSeriesMeta(selectedExpectedInstance.expected_transaction_id);
  if (!meta || meta.recurrence === "once") {
    throw new Error("This series is not recurring.");
  }
  const occ = normalizeIsoDate(selectedExpectedInstance.occurrence_date);
  if (!occ) throw new Error("Invalid occurrence date");
  await api(
    `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/end-from-occurrence/${occ}`,
    "POST"
  );
  closeTxEditDeleteScopeModal();
  closeTxEditModal();
  await refreshExpectedCalendarAndMonth();
}

async function saveExpectedInstanceOverride() {
  show(txEditErr, "");
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");

  const amountVal = txEditAmount.value;
  const amount = amountVal ? Number(amountVal) : null;
  if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error("Amount must be > 0");

  const accountId = instanceAccountId.value;
  if (!accountId) throw new Error("Account is required");

  const categoryId = categoryIdFromCategoryField("txEditCategoryId");

  const occ = normalizeIsoDate(selectedExpectedInstance.occurrence_date);
  if (!occ) throw new Error("Invalid occurrence date");
  const movedTo = normalizeIsoDate(selectedExpectedMovedToDate || "") || null;

  const payload = {
    action: "update",
    account_id: Number(accountId),
    kind: getRadioValue("txEditKind", "expense"),
    amount,
    description: expectedSaveDescription(),
    category_id: categoryId,
    moved_to_date: movedTo,
    variable: !!(seriesVariable && seriesVariable.checked),
  };
  await api(
    `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${occ}`,
    "POST",
    payload
  );

  closeTxEditModal();
  await refreshExpectedCalendarAndMonth();
}

async function saveExpectedSeriesFromInstance() {
  show(txEditErr, "");
  if (!state.activeFamilyId) throw new Error("Choose a family first");
  const seriesId = selectedExpectedInstance
    ? Number(selectedExpectedInstance.expected_transaction_id)
    : Number(expectedEditId?.value || 0);
  if (!seriesId) throw new Error("No recurring transaction selected");

  const meta = selectedExpectedSeriesTx || getExpectedSeriesMeta(seriesId);
  if (!meta) throw new Error("Could not load series details");

  const amountVal = txEditAmount?.value;
  const amount = amountVal ? Number(amountVal) : null;
  if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error("Amount must be > 0");

  const accountId = instanceAccountId?.value;
  if (!accountId) throw new Error("Account is required");

  const categoryId = categoryIdFromCategoryField("txEditCategoryId");
  const notesVal = txEditNotes ? txEditNotes.value.trim() || null : null;

  const recurrenceVal = instanceRecurrence?.value || meta.recurrence || "monthly";
  let secondDayVal = meta.second_day_of_month != null ? Number(meta.second_day_of_month) : null;
  if (recurrenceVal === "twice_monthly") {
    const raw = instanceSecondDayOfMonth?.value;
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 31) throw new Error("Second day of month must be between 1 and 31");
    const occIso = selectedExpectedInstance
      ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) || selectedExpectedInstance.occurrence_date
      : null;
    const occDom = occIso && String(occIso).length >= 10 ? Number(String(occIso).slice(8, 10)) : NaN;
    if (Number.isFinite(occDom) && n === occDom) {
      throw new Error("Second day of month must be different than this occurrence’s day");
    }
    secondDayVal = n;
  } else {
    secondDayVal = null;
  }

  const occRaw = selectedExpectedInstance
    ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) || selectedExpectedInstance.occurrence_date
    : null;
  if (!occRaw) {
    throw new Error("Pick an occurrence from the calendar or recurring list to update this date and all future ones.");
  }

  if (String(meta.recurrence || "") === "once") {
    await api(`/api/families/${state.activeFamilyId}/expected-transactions/${seriesId}`, "PUT", {
      account_id: Number(accountId),
      start_date: meta.start_date || "",
      end_date: meta.end_date || null,
      recurrence: recurrenceVal,
      second_day_of_month: recurrenceVal === "twice_monthly" ? secondDayVal : null,
      description: expectedSaveDescription(),
      notes: notesVal,
      kind: getRadioValue("txEditKind", "expense"),
      amount: Number(amount),
      variable: !!(seriesVariable && seriesVariable.checked),
      category_id: categoryId,
    });
  } else {
    const applyBody = {
      account_id: Number(accountId),
      kind: getRadioValue("txEditKind", "expense"),
      amount: Number(amount),
      description: expectedSaveDescription(),
      reimbursable: !!meta.reimbursable,
      category_id: categoryId,
      notes: notesVal,
      recurrence: recurrenceVal,
      variable: !!(seriesVariable && seriesVariable.checked),
    };
    if (recurrenceVal === "twice_monthly") applyBody.second_day_of_month = secondDayVal;
    await api(
      `/api/families/${state.activeFamilyId}/expected-transactions/${seriesId}/apply-from-occurrence/${encodeURIComponent(occRaw)}`,
      "POST",
      applyBody
    );
  }

  closeTxEditModal();
  await refreshExpectedCalendarAndMonth();
}

if (txEditRecurringUpdateBtn) {
  txEditRecurringUpdateBtn.addEventListener("click", () => {
    show(txEditErr, "");
    const pre = validateTxEditBeforeRecurringApply();
    if (pre) {
      show(txEditErr, pre);
      return;
    }
    openTxEditApplyScopeModal();
  });
}

const txEditApplyScopeInstanceBtn = document.getElementById("txEditApplyScopeInstanceBtn");
if (txEditApplyScopeInstanceBtn) {
  txEditApplyScopeInstanceBtn.addEventListener("click", async () => {
    try {
      await saveExpectedInstanceOverride();
    } catch (e) {
      show(document.getElementById("txEditApplyScopeErr"), e.message || "Failed to save override");
    }
  });
}

const txEditApplyScopeSeriesBtn = document.getElementById("txEditApplyScopeSeriesBtn");
if (txEditApplyScopeSeriesBtn) {
  txEditApplyScopeSeriesBtn.addEventListener("click", async () => {
    try {
      await saveExpectedSeriesFromInstance();
    } catch (e) {
      show(document.getElementById("txEditApplyScopeErr"), e.message || "Failed to save");
    }
  });
}

const txEditApplyScopeCancelBtn = document.getElementById("txEditApplyScopeCancelBtn");
if (txEditApplyScopeCancelBtn) {
  txEditApplyScopeCancelBtn.addEventListener("click", () => closeTxEditApplyScopeModal());
}

const txEditApplyScopeModal = document.getElementById("txEditApplyScopeModal");
if (txEditApplyScopeModal) {
  txEditApplyScopeModal.addEventListener("click", (e) => {
    if (e.target === txEditApplyScopeModal) closeTxEditApplyScopeModal();
  });
}

const txEditDeleteScopeModal = document.getElementById("txEditDeleteScopeModal");
if (txEditDeleteScopeModal) {
  txEditDeleteScopeModal.addEventListener("click", (e) => {
    if (e.target === txEditDeleteScopeModal) closeTxEditDeleteScopeModal();
  });
}

const txEditDeleteScopeInstanceBtn = document.getElementById("txEditDeleteScopeInstanceBtn");
if (txEditDeleteScopeInstanceBtn) {
  txEditDeleteScopeInstanceBtn.addEventListener("click", async () => {
    try {
      await deleteExpectedThisOccurrenceOnlyFromModal();
    } catch (e) {
      show(document.getElementById("txEditDeleteScopeErr"), e.message || "Failed to remove occurrence");
    }
  });
}

const txEditDeleteScopeFutureBtn = document.getElementById("txEditDeleteScopeFutureBtn");
if (txEditDeleteScopeFutureBtn) {
  txEditDeleteScopeFutureBtn.addEventListener("click", async () => {
    try {
      await deleteExpectedThisAndFutureFromModal();
    } catch (e) {
      show(document.getElementById("txEditDeleteScopeErr"), e.message || "Failed to delete future occurrences");
    }
  });
}

const txEditDeleteScopeCancelBtn = document.getElementById("txEditDeleteScopeCancelBtn");
if (txEditDeleteScopeCancelBtn) {
  txEditDeleteScopeCancelBtn.addEventListener("click", () => closeTxEditDeleteScopeModal());
}

async function loadMe() {
  const data = await api("/api/auth/me", "GET");
  if (!data?.user) throw new Error("Not logged in");
  state.user = data.user;
  userPill.textContent = state.user.name ? state.user.name : state.user.email;
}

async function loadFamilies() {
  const families = await api("/api/families", "GET");
  state.families = families || [];

  familySelect.innerHTML = "";
  for (const f of state.families) {
    const opt = document.createElement("option");
    opt.value = String(f.id);
    opt.textContent = f.name;
    familySelect.appendChild(opt);
  }

  if (state.families.length > 0) {
    state.activeFamilyId = Number(familySelect.value);
  }
}

function categoryIdFromSelectValue(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Reads category id from a plain select or a mounted category combobox (flushes typed text to hidden value first). */
function categoryIdFromCategoryField(fieldId) {
  if (categoryComboboxRegistry.has(fieldId)) {
    normalizeCategoryComboboxInput(fieldId);
    const st = categoryComboboxRegistry.get(fieldId);
    if (st) return categoryIdFromSelectValue(st.hidden.value);
  }
  return categoryIdFromSelectValue(document.getElementById(fieldId)?.value);
}

const CATEGORY_COMBOBOX_FIELD_IDS = ["txAddCategoryId", "txEditCategoryId"];

/** @type {Map<string, { wrap: HTMLElement, input: HTMLInputElement, hidden: HTMLInputElement, list: HTMLUListElement, categories: { id: number | string; name: string }[], blurTimer: ReturnType<typeof setTimeout> | null }>} */
const categoryComboboxRegistry = new Map();

let categoryComboOutsideClickBound = false;

function categoryComboSearchInputId(fieldId) {
  return `${fieldId}_search`;
}

function hideCategoryComboboxList(st) {
  st.list.hidden = true;
  st.input.setAttribute("aria-expanded", "false");
  for (const li of st.list.querySelectorAll("li.category-combobox__option.is-active")) {
    li.classList.remove("is-active");
  }
}

function showCategoryComboboxList(st) {
  st.list.hidden = false;
  st.input.setAttribute("aria-expanded", "true");
}

function getCategoryComboboxActiveIndex(st) {
  const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
  return els.findIndex((li) => li.classList.contains("is-active"));
}

function setCategoryComboboxActiveIndex(st, index) {
  const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
  for (const li of els) li.classList.remove("is-active");
  if (index >= 0 && index < els.length) {
    els[index].classList.add("is-active");
    els[index].scrollIntoView({ block: "nearest" });
  }
}

function selectCategoryComboboxChoice(fieldId, catId, name) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  st.hidden.value = String(catId);
  st.input.value = name;
  hideCategoryComboboxList(st);
}

function normalizeCategoryComboboxInput(fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  const hid = st.hidden.value.trim();
  if (hid) {
    const cat = (st.categories || []).find((c) => String(c.id) === String(hid));
    st.input.value = cat ? cat.name : "";
    return;
  }
  const q = st.input.value.trim().toLowerCase();
  if (!q) {
    st.input.value = "";
    return;
  }
  const exact = (st.categories || []).filter((c) => String(c.name).trim().toLowerCase() === q);
  if (exact.length === 1) {
    st.hidden.value = String(exact[0].id);
    st.input.value = exact[0].name;
    return;
  }
  const subs = (st.categories || []).filter((c) => String(c.name).toLowerCase().includes(q));
  if (subs.length === 1) {
    st.hidden.value = String(subs[0].id);
    st.input.value = subs[0].name;
    return;
  }
  st.input.value = "";
}

function filterCategoryCombobox(fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  const q = st.input.value.trim().toLowerCase();
  const cats = st.categories || [];
  const filtered = !q ? cats.slice() : cats.filter((c) => String(c.name).toLowerCase().includes(q));

  st.list.innerHTML = "";
  for (const c of filtered) {
    const li = document.createElement("li");
    li.className = "category-combobox__option";
    li.setAttribute("role", "option");
    li.dataset.id = String(c.id);
    li.textContent = c.name;
    st.list.appendChild(li);
  }
  const addLi = document.createElement("li");
  addLi.className = "category-combobox__option category-combobox__option--add";
  addLi.setAttribute("role", "option");
  addLi.textContent = "Add new category…";
  st.list.appendChild(addLi);
}

function applyCategoryComboboxPickFromLi(fieldId, li) {
  if (!li) return;
  if (li.classList.contains("category-combobox__option--add")) {
    void handleAddNewCategoryFromCombobox(fieldId);
    return;
  }
  const id = li.dataset.id;
  if (id) selectCategoryComboboxChoice(fieldId, id, li.textContent || "");
}

async function handleAddNewCategoryFromCombobox(fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (st) hideCategoryComboboxList(st);
  const name = window.prompt("Name for the new category:");
  if (!name || !String(name).trim()) return;
  try {
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    await api(`/api/families/${state.activeFamilyId}/categories`, "POST", { name: String(name).trim() });
    await loadCategories();
    const trimmed = String(name).trim();
    const newCat = (state.categories || []).find((c) => String(c.name).trim() === trimmed);
    if (newCat) selectCategoryComboboxChoice(fieldId, newCat.id, newCat.name);
  } catch (err) {
    window.alert(err.message || "Failed to add category");
  }
}

function onCategoryComboboxKeydown(e, fieldId) {
  const st = categoryComboboxRegistry.get(fieldId);
  if (!st) return;
  if (e.key === "Escape") {
    e.preventDefault();
    hideCategoryComboboxList(st);
    normalizeCategoryComboboxInput(fieldId);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (st.list.hidden) {
      showCategoryComboboxList(st);
      filterCategoryCombobox(fieldId);
    }
    const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
    if (!els.length) return;
    let idx = getCategoryComboboxActiveIndex(st);
    if (idx < 0) {
      idx = e.key === "ArrowDown" ? -1 : els.length;
    }
    if (e.key === "ArrowDown") idx = Math.min(idx + 1, els.length - 1);
    else idx = Math.max(idx - 1, 0);
    setCategoryComboboxActiveIndex(st, idx);
    return;
  }
  if (e.key === "Enter") {
    if (!st.list.hidden) {
      const idx = getCategoryComboboxActiveIndex(st);
      const els = Array.from(st.list.querySelectorAll("li.category-combobox__option"));
      if (idx >= 0 && els[idx]) {
        e.preventDefault();
        applyCategoryComboboxPickFromLi(fieldId, els[idx]);
        return;
      }
    }
    const q = st.input.value.trim().toLowerCase();
    const cats = st.categories || [];
    const filtered = !q ? cats : cats.filter((c) => String(c.name).toLowerCase().includes(q));
    if (filtered.length === 1) {
      e.preventDefault();
      selectCategoryComboboxChoice(fieldId, filtered[0].id, filtered[0].name);
    }
  }
}

function mountCategoryComboboxFromSelect(selectEl) {
  const fieldId = selectEl.id;
  if (!fieldId || categoryComboboxRegistry.has(fieldId)) return;

  ensureCategoryComboDocClick();

  const wrap = document.createElement("div");
  wrap.className = "category-combobox";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "category-combobox__input";
  input.id = categoryComboSearchInputId(fieldId);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", `${fieldId}_list`);
  input.autocomplete = "off";
  input.placeholder = "Type to filter…";
  input.spellcheck = false;

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.id = fieldId;

  const list = document.createElement("ul");
  list.className = "category-combobox__list";
  list.id = `${fieldId}_list`;
  list.setAttribute("role", "listbox");
  list.hidden = true;

  selectEl.replaceWith(wrap);
  wrap.appendChild(input);
  wrap.appendChild(hidden);
  wrap.appendChild(list);

  const label = document.querySelector(`label[for="${fieldId}"]`);
  if (label) label.setAttribute("for", input.id);

  const st = {
    wrap,
    input,
    hidden,
    list,
    categories: [],
    blurTimer: null,
  };
  categoryComboboxRegistry.set(fieldId, st);

  list.addEventListener("mousedown", (e) => {
    const li = e.target && /** @type {HTMLElement} */ (e.target).closest("li.category-combobox__option");
    if (!li || !list.contains(li)) return;
    e.preventDefault();
    if (st.blurTimer) {
      clearTimeout(st.blurTimer);
      st.blurTimer = null;
    }
    applyCategoryComboboxPickFromLi(fieldId, li);
  });

  input.addEventListener("input", () => filterCategoryCombobox(fieldId));
  input.addEventListener("focus", () => {
    showCategoryComboboxList(st);
    filterCategoryCombobox(fieldId);
  });
  input.addEventListener("blur", () => {
    if (st.blurTimer) clearTimeout(st.blurTimer);
    st.blurTimer = setTimeout(() => {
      st.blurTimer = null;
      normalizeCategoryComboboxInput(fieldId);
      hideCategoryComboboxList(st);
    }, 180);
  });
  input.addEventListener("keydown", (e) => onCategoryComboboxKeydown(e, fieldId));
}

function syncCategoryComboboxCategories(fieldId, categories) {
  ensureCategoryComboDocClick();
  let st = categoryComboboxRegistry.get(fieldId);
  if (!st) {
    const el = document.getElementById(fieldId);
    if (!el || !(el instanceof HTMLSelectElement)) return;
    mountCategoryComboboxFromSelect(el);
    st = categoryComboboxRegistry.get(fieldId);
  }
  if (!st) return;
  st.categories = categories || [];
  const cur = st.hidden.value;
  if (cur) {
    const cat = st.categories.find((c) => String(c.id) === String(cur));
    st.input.value = cat ? cat.name : "";
  }
  if (!st.list.hidden) filterCategoryCombobox(fieldId);
}

function syncAllCategoryComboboxes(categories) {
  for (const fid of CATEGORY_COMBOBOX_FIELD_IDS) {
    syncCategoryComboboxCategories(fid, categories);
  }
}

function setCategoryFieldValue(fieldId, categoryIdOrNull) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  if (categoryComboboxRegistry.has(fieldId)) {
    const st = categoryComboboxRegistry.get(fieldId);
    if (!st) return;
    if (categoryIdOrNull == null || categoryIdOrNull === "") {
      st.hidden.value = "";
      st.input.value = "";
    } else {
      const cat = (st.categories || []).find((c) => Number(c.id) === Number(categoryIdOrNull));
      const name =
        cat?.name ||
        (state.categories || []).find((c) => Number(c.id) === Number(categoryIdOrNull))?.name ||
        "";
      st.hidden.value = String(categoryIdOrNull);
      st.input.value = name;
    }
    return;
  }
  if (el instanceof HTMLSelectElement) {
    el.value = categoryIdOrNull != null && categoryIdOrNull !== "" ? String(categoryIdOrNull) : "";
  }
}

function ensureCategoryComboDocClick() {
  if (categoryComboOutsideClickBound) return;
  categoryComboOutsideClickBound = true;
  document.addEventListener("click", (e) => {
    const t = /** @type {Node} */ (e.target);
    for (const [, st] of categoryComboboxRegistry) {
      if (st.wrap.contains(t)) continue;
      hideCategoryComboboxList(st);
    }
  });
}

let categoryPalettePopoverEl = null;
let categoryPalettePopoverCleanup = null;

function closeCategoryPalettePopover() {
  if (categoryPalettePopoverCleanup) {
    categoryPalettePopoverCleanup();
    categoryPalettePopoverCleanup = null;
  }
  if (categoryPalettePopoverEl) {
    categoryPalettePopoverEl.remove();
    categoryPalettePopoverEl = null;
  }
}

/**
 * Opens a single floating palette (closes any other open category palette).
 * @param {HTMLElement} anchorBtn
 * @param {string[]} palette
 * @param {string} currentHex
 * @param {(hex: string) => void} onPick — called when user picks; popover closes after.
 */
function openCategoryPalettePopover(anchorBtn, palette, currentHex, onPick) {
  closeCategoryPalettePopover();

  const pop = document.createElement("div");
  pop.className = "palette-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Choose color");

  const grid = document.createElement("div");
  grid.className = "palette-grid";
  const cur = (currentHex || "").toLowerCase();

  for (const hex of palette) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = hex;
    b.setAttribute("aria-label", hex);
    b.title = hex;
    if (cur && cur === hex.toLowerCase()) b.classList.add("is-selected");
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPick(hex);
      closeCategoryPalettePopover();
    });
    grid.appendChild(b);
  }
  pop.appendChild(grid);
  document.body.appendChild(pop);
  categoryPalettePopoverEl = pop;

  const place = () => {
    const r = anchorBtn.getBoundingClientRect();
    const w = pop.offsetWidth || 200;
    const h = pop.offsetHeight || 200;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(place);

  const onDocMouseDown = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
      closeCategoryPalettePopover();
    }
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") closeCategoryPalettePopover();
  };
  const onScroll = () => place();

  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", place);

  categoryPalettePopoverCleanup = () => {
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", place);
  };
}

function renderCategoriesGrid(categories) {
  if (!categoriesGrid) return;
  closeCategoryPalettePopover();
  categoriesGrid.innerHTML = "";
  const items = categories || [];
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No categories yet.";
    categoriesGrid.appendChild(empty);
    return;
  }

  const DEFAULT_FG = "#e8eefc";
  const DEFAULT_BG = "#121b31";
  const PALETTE = [
    "#0b1220","#121b31","#1b2a4a","#24365f","#2d4478","#365392","#4063ad","#4a74c9",
    "#66a3ff","#66d6ff","#5fe8d5","#4cd17b","#3fbf8a","#2da66f","#1f8f58","#167243",
    "#ffd166","#ffb703","#fb8500","#f77f00","#ef476f","#ff6b6b","#e63946","#c1121f",
    "#b5179e","#7209b7","#3a0ca3","#4361ee","#4895ef","#4cc9f0","#8ecae6","#219ebc",
    "#00b4d8","#0077b6","#023e8a","#03045e","#f1faee","#a8dadc","#457b9d","#1d3557",
    "#f8f9fa","#dee2e6","#adb5bd","#6c757d","#495057","#343a40","#212529","#ffffff",
    "#e9ecef","#ced4da","#b0c4de","#9fb0d0","#7f8fb3","#5b6b91","#3c4a6b","#2a3550",
  ];

  function normalizeHex(v, fallback) {
    const s = (v || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
  }

  function makeColorTrigger(label, getHex, setHex) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-color-trigger";
    btn.setAttribute("aria-label", label);
    btn.title = `Choose ${label.toLowerCase()} color`;
    function paint() {
      const h = getHex();
      btn.style.background = h;
    }
    paint();
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCategoryPalettePopover(btn, PALETTE, getHex(), (hex) => {
        setHex(hex);
        paint();
      });
    });
    return btn;
  }

  // Header
  const hName = document.createElement("div");
  hName.className = "cat-h";
  hName.textContent = "Category";
  const hFg = document.createElement("div");
  hFg.className = "cat-h";
  hFg.textContent = "Text";
  const hBg = document.createElement("div");
  hBg.className = "cat-h";
  hBg.textContent = "Bg";
  const hAct = document.createElement("div");
  hAct.className = "cat-h";
  hAct.textContent = "";
  categoriesGrid.appendChild(hName);
  categoriesGrid.appendChild(hFg);
  categoriesGrid.appendChild(hBg);
  categoriesGrid.appendChild(hAct);

  // Render in server-provided order (drag/drop persists sort_order).
  const ordered = [...items];

  async function persistOrder(ids) {
    if (!state.activeFamilyId) return;
    await api(`/api/families/${state.activeFamilyId}/categories/reorder`, "POST", { ordered_ids: ids });
  }

  function currentIds() {
    return [...categoriesGrid.querySelectorAll(".cat-row[data-category-id]")].map((el) => Number(el.dataset.categoryId));
  }

  function moveIdBefore(list, movingId, beforeId) {
    const next = list.filter((x) => x !== movingId);
    const idx = next.indexOf(beforeId);
    if (idx < 0) return next;
    next.splice(idx, 0, movingId);
    return next;
  }

  for (const c of ordered) {
    const row = document.createElement("div");
    row.className = "cat-row";
    row.dataset.categoryId = String(c.id);
    row.draggable = true;

    const nameEl = document.createElement("div");
    nameEl.className = "cat-name";
    nameEl.textContent = c.name;
    nameEl.title = c.name;
    nameEl.classList.add("cat-drag-handle");

    let fgVal = normalizeHex(c.fg_color, DEFAULT_FG);
    let bgVal = normalizeHex(c.bg_color, DEFAULT_BG);
    const fgTrigger = makeColorTrigger("Text color", () => fgVal, (h) => (fgVal = h));
    const bgTrigger = makeColorTrigger("Background color", () => bgVal, (h) => (bgVal = h));

    const actions = document.createElement("div");
    actions.className = "cat-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "cat-save";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      try {
        show(catErr, "");
        if (!state.activeFamilyId) throw new Error("Choose a family first");
        await api(`/api/families/${state.activeFamilyId}/categories/${c.id}`, "PUT", {
          fg_color: fgVal,
          bg_color: bgVal,
        });
        await loadCategories();
        await loadMonthAndCalendar();
      } catch (e) {
        show(catErr, e.message || "Failed to update category");
      }
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "cat-reset";
    reset.textContent = "Reset";
    reset.title = "Reset to default colors";
    reset.addEventListener("click", async () => {
      try {
        show(catErr, "");
        if (!state.activeFamilyId) throw new Error("Choose a family first");
        await api(`/api/families/${state.activeFamilyId}/categories/${c.id}`, "PUT", {
          fg_color: "",
          bg_color: "",
        });
        await loadCategories();
        await loadMonthAndCalendar();
      } catch (e) {
        show(catErr, e.message || "Failed to reset category");
      }
    });

    actions.appendChild(save);
    actions.appendChild(reset);

    // Use display: contents so the row participates in the grid.
    row.appendChild(nameEl);
    row.appendChild(fgTrigger);
    row.appendChild(bgTrigger);
    row.appendChild(actions);
    categoriesGrid.appendChild(row);

    row.addEventListener("dragstart", (e) => {
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.dataset.categoryId || "");
      } catch (_) {}
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      categoriesGrid.querySelectorAll(".cat-row.is-drag-over").forEach((x) => x.classList.remove("is-drag-over"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("is-drag-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      row.classList.remove("is-drag-over");
      const raw = (() => {
        try {
          return e.dataTransfer.getData("text/plain");
        } catch (_) {
          return "";
        }
      })();
      const movingId = Number(raw);
      const beforeId = Number(row.dataset.categoryId);
      if (!movingId || !beforeId || movingId === beforeId) return;
      const ids = currentIds();
      const nextIds = moveIdBefore(ids, movingId, beforeId);
      try {
        // Optimistic UI: reorder DOM immediately.
        const idToRow = new Map(
          [...categoriesGrid.querySelectorAll(".cat-row[data-category-id]")].map((el) => [Number(el.dataset.categoryId), el])
        );
        for (const el of idToRow.values()) el.remove();
        for (const id of nextIds) {
          const el = idToRow.get(id);
          if (el) categoriesGrid.appendChild(el);
        }
        await persistOrder(nextIds);
        await loadCategories();
      } catch (err) {
        show(catErr, err.message || "Failed to reorder categories");
        await loadCategories();
      }
    });
  }
}

async function loadCategories() {
  if (!state.activeFamilyId) return;
  const categories = await api(`/api/families/${state.activeFamilyId}/categories`, "GET");
  state.categories = categories || [];
  renderCategoriesGrid(state.categories);
  syncAllCategoryComboboxes(state.categories);
}

function categoryStyleFromId(categoryId) {
  if (!categoryId) return null;
  const c = (state.categories || []).find((x) => Number(x.id) === Number(categoryId));
  if (!c) return null;
  const fg = c.fg_color && String(c.fg_color).trim() ? String(c.fg_color).trim() : null;
  const bg = c.bg_color && String(c.bg_color).trim() ? String(c.bg_color).trim() : null;
  return { name: c.name, fg, bg };
}

function parseCssColorToRgb(input) {
  const t = String(input || "").trim();
  if (!t) return null;
  let m = /^#([0-9a-fA-F]{6})$/i.exec(t);
  if (m) {
    const h = m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  m = /^#([0-9a-fA-F]{3})$/i.exec(t);
  if (m) {
    const x = m[1];
    return { r: parseInt(x[0] + x[0], 16), g: parseInt(x[1] + x[1], 16), b: parseInt(x[2] + x[2], 16) };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(t);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  return null;
}

function relativeLuminanceFromRgb(rgb) {
  const lin = (c) => {
    const v = Math.max(0, Math.min(255, c)) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = lin(rgb.r);
  const g = lin(rgb.g);
  const b = lin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatioBetweenRgb(fgRgb, bgRgb) {
  const L1 = relativeLuminanceFromRgb(fgRgb) + 0.05;
  const L2 = relativeLuminanceFromRgb(bgRgb) + 0.05;
  return Math.max(L1, L2) / Math.min(L1, L2);
}

/** Pick near-black or white, whichever reads better on this background (WCAG-style contrast). */
function accessibleTextOnBackground(bgCss) {
  const bgRgb = parseCssColorToRgb(bgCss);
  if (!bgRgb) return "#111827";
  const dark = { r: 17, g: 24, b: 39 };
  const light = { r: 255, g: 255, b: 255 };
  const cDark = contrastRatioBetweenRgb(dark, bgRgb);
  const cLight = contrastRatioBetweenRgb(light, bgRgb);
  return cDark >= cLight ? "rgb(17, 24, 39)" : "#ffffff";
}

const CATEGORY_PILL_MIN_CONTRAST = 4.5;

/** fg/bg for category chips: keep custom colors but fix low-contrast pairs (e.g. white on yellow). */
function categoryPillStyleFromId(categoryId) {
  const st = categoryStyleFromId(categoryId);
  if (!st) return null;
  const { fg: fgUser, bg } = st;
  if (!bg) return st;
  const bgRgb = parseCssColorToRgb(bg);
  if (!bgRgb) {
    return { ...st, fg: fgUser || accessibleTextOnBackground(bg) };
  }
  if (!fgUser) {
    return { ...st, fg: accessibleTextOnBackground(bg) };
  }
  const fgRgb = parseCssColorToRgb(fgUser);
  if (fgRgb && contrastRatioBetweenRgb(fgRgb, bgRgb) >= CATEGORY_PILL_MIN_CONTRAST) {
    return st;
  }
  return { ...st, fg: accessibleTextOnBackground(bg) };
}

/** Default label text color: green income / red expense (custom category fg overrides where applied). */
function kindFgClass(kind) {
  return String(kind) === "income" ? "tx-kind-fg--income" : "tx-kind-fg--expense";
}

function renderAccountsList(accounts) {
  accountsList.innerHTML = "";
  if (!accounts || accounts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No accounts yet.";
    accountsList.appendChild(empty);
    return;
  }

  for (const a of accounts) {
    const el = document.createElement("div");
    el.className = "item";

    const typeLabel = String(a.type).replaceAll("_", " ");
    const startDate = a.starting_balance_date || "";
    el.innerHTML = `
      <div class="left">
        <div class="desc">${escapeHtml(a.name)}</div>
        <div class="meta">${typeLabel} · Starting: $${fmtMoney(a.starting_balance)} on ${escapeHtml(fmtDateMDY(startDate))}</div>
      </div>
      <div class="row-actions">
        <div class="amt">${fmtMoney(a.starting_balance)}</div>
        <button type="button" class="edit-account-btn" data-account-id="${a.id}">Edit</button>
      </div>
    `;
    accountsList.appendChild(el);
  }

  for (const btn of accountsList.querySelectorAll(".edit-account-btn")) {
    btn.addEventListener("click", () => {
      const accountId = Number(btn.dataset.accountId);
      const account = state.accounts.find((a) => Number(a.id) === accountId);
      if (!account) return;
      accountEditId.value = String(account.id);
      accountName.value = account.name || "";
      accountType.value = account.type || "checking";
      accountStartingBalance.value = account.starting_balance ?? "";
      accountStartingBalanceDate.value = account.starting_balance_date || "";
      accountName.disabled = true;
      accountType.disabled = true;
      show(accErr, "Editing selected account's starting balance/date.");
    });
  }
}

function renderAccountSelect(selectEl, accounts) {
  selectEl.innerHTML = "";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "Choose account";
  selectEl.appendChild(emptyOpt);

  for (const a of accounts || []) {
    const opt = document.createElement("option");
    opt.value = String(a.id);
    opt.textContent = a.name;
    selectEl.appendChild(opt);
  }
}

async function loadAccounts() {
  if (!state.activeFamilyId) return;
  const accounts = await api(`/api/families/${state.activeFamilyId}/accounts`, "GET");
  state.accounts = accounts || [];
  renderAccountsList(state.accounts);
  const expectedAccountIdEl = document.getElementById("expectedAccountId");
  if (expectedAccountIdEl) renderAccountSelect(expectedAccountIdEl, state.accounts);
  if (expectedEditAccountId) renderAccountSelect(expectedEditAccountId, state.accounts);
  if (txAddAccountId) renderAccountSelect(txAddAccountId, state.accounts);
  if (instanceAccountId) renderAccountSelect(instanceAccountId, state.accounts);
  if (expectedAccountIdEl && state.accounts.length > 0 && !expectedAccountIdEl.value) {
    expectedAccountIdEl.value = String(state.accounts[0].id);
  }
}

function clearAccountEdit() {
  accountEditId.value = "";
  accountName.value = "";
  accountType.value = "checking";
  accountStartingBalance.value = "";
  accountStartingBalanceDate.value = "";
  accountName.disabled = false;
  accountType.disabled = false;
  show(accErr, "");
}

function setExpectedModalMode() {
  const instPanel = document.getElementById("expectedEditInstancePanel");
  if (instPanel) instPanel.style.display = "block";
}

async function refreshExpectedCalendarAndMonth() {
  await loadExpectedTransactions();
  await loadExpectedCalendar();
  await loadCalendarMonthDaily();
  renderCalendar();
}

function openExpectedEditModal(tx, opts = {}) {
  if (!txEditModal || !expectedEditId) return;
  const calendarItem = opts.calendarItem ?? null;

  if (txEditId) txEditId.value = "";
  expectedEditId.value = String(tx.id);
  selectedExpectedSeriesTx = tx;
  renderTxEditCategoryOptions();

  if (calendarItem) {
    selectExpectedInstance(calendarItem);
  } else {
    // Opened from a non-calendar surface (ex: Transaction View recurring filter list).
    // Seed the modal with the next scheduled occurrence so instance editing endpoints have a date.
    const basisIso = opts.nextOccurrenceIso ? normalizeIsoDate(opts.nextOccurrenceIso) : toISODate(new Date());
    const nextIso = opts.nextOccurrenceIso ? normalizeIsoDate(opts.nextOccurrenceIso) : nextExpectedOccurrenceIso(tx, basisIso);
    if (!nextIso) {
      selectedExpectedInstance = null;
      if (txEditDate) {
        txEditDate.value = "";
        txEditDate.disabled = true;
      }
      if (instanceExpectedTxId) instanceExpectedTxId.value = String(tx.id);
      if (txEditNotes) txEditNotes.value = tx.notes || "";
      {
        const k = tx && tx.kind ? String(tx.kind) : "expense";
        const radio = document.querySelector(`input[type="radio"][name="txEditKind"][value="${k}"]`);
        if (radio) radio.checked = true;
      }
      if (txEditAmount) txEditAmount.value = String(tx.amount ?? "");
      if (instanceAccountId) instanceAccountId.value = tx.account_id != null ? String(tx.account_id) : "";
      setCategoryFieldValue("txEditCategoryId", tx.category_id);
    } else {
      const accountId = tx.account_id != null ? Number(tx.account_id) : NaN;
      const acct = Number.isFinite(accountId) ? state.accounts.find((a) => Number(a.id) === accountId) : null;
      const catId = tx.category_id != null ? Number(tx.category_id) : null;
      const cat = catId != null ? (state.categories || []).find((c) => Number(c.id) === catId) : null;
      const synthetic = {
        expected_transaction_id: Number(tx.id),
        date: nextIso,
        occurrence_date: nextIso,
        account_id: Number.isFinite(accountId) ? accountId : tx.account_id,
        account: acct?.name || "",
        kind: tx.kind,
        amount: tx.amount,
        description: tx.description || "",
        notes: tx.notes || "",
        reimbursable: !!tx.reimbursable,
        variable: !!tx.variable,
        category_id: catId,
        category: cat?.name || null,
      };
      // `selectExpectedInstance` is defined later in this file; schedule after parse completes.
      queueMicrotask(() => selectExpectedInstance(synthetic));
    }
  }

  if (instanceRecurrence) instanceRecurrence.value = String((selectedExpectedSeriesTx && selectedExpectedSeriesTx.recurrence) || tx.recurrence || "monthly");
  if (instanceSecondDayOfMonth) {
    const v = (selectedExpectedSeriesTx && selectedExpectedSeriesTx.second_day_of_month) != null ? selectedExpectedSeriesTx.second_day_of_month : tx.second_day_of_month;
    instanceSecondDayOfMonth.value = v != null ? String(v) : "";
  }
  updateInstanceTwiceMonthlyVisibility();

  if (seriesVariable) seriesVariable.checked = !!tx.variable;

  setExpectedModalMode();
  show(txEditErr, "");
  txEditModal.classList.add("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "false");
  applyTransactionEditMode("recurring");
}

function openExpectedDeleteModal(expectedId, occurrenceDate) {
  if (!expectedDeleteModal) return;
  expectedDeleteContext = { expectedId: expectedId ? String(expectedId) : null, occurrenceDate: occurrenceDate || null };
  show(expectedDeleteErr, "");

  const hasOcc = !!expectedDeleteContext.occurrenceDate;
  if (expectedDeleteThisBtn) expectedDeleteThisBtn.disabled = !hasOcc;
  if (expectedDeleteFutureBtn) expectedDeleteFutureBtn.disabled = !hasOcc;
  if (expectedDeleteThisBtn) expectedDeleteThisBtn.title = hasOcc ? "" : "Open from a specific calendar date to delete only one occurrence.";
  if (expectedDeleteFutureBtn) expectedDeleteFutureBtn.title = hasOcc ? "" : "Open from a specific calendar date to delete future occurrences.";

  expectedDeleteModal.classList.add("modal-overlay--open");
  expectedDeleteModal.setAttribute("aria-hidden", "false");
}

function closeExpectedDeleteModal() {
  if (!expectedDeleteModal) return;
  expectedDeleteModal.classList.remove("modal-overlay--open");
  expectedDeleteModal.setAttribute("aria-hidden", "true");
  expectedDeleteContext = { expectedId: null, occurrenceDate: null };
}

// Edit scope radio buttons removed (replaced with save options).

if (expectedDeleteCancelBtn) {
  expectedDeleteCancelBtn.addEventListener("click", () => closeExpectedDeleteModal());
}
if (expectedDeleteModal) {
  expectedDeleteModal.addEventListener("click", (e) => {
    if (e.target === expectedDeleteModal) closeExpectedDeleteModal();
  });
}

async function runExpectedDeleteAction(mode) {
  try {
    show(expectedDeleteErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    const expectedId = expectedDeleteContext.expectedId;
    if (!expectedId) throw new Error("No series selected");

    if (mode === "all") {
      if (!confirm("Delete ALL transactions in this series (all dates)? This cannot be undone.")) return;
      await api(`/api/families/${state.activeFamilyId}/expected-transactions/${expectedId}`, "DELETE");
    } else if (mode === "this") {
      const occ = expectedDeleteContext.occurrenceDate;
      if (!occ) throw new Error('Open from a specific calendar date to use "Delete only this transaction".');
      if (!confirm("Delete ONLY this occurrence? It will no longer appear on the calendar.")) return;
      await api(
        `/api/families/${state.activeFamilyId}/expected-transactions/${expectedId}/instances/${occ}`,
        "POST",
        { action: "cancel" }
      );
    } else if (mode === "future") {
      const occ = expectedDeleteContext.occurrenceDate;
      if (!occ) throw new Error('Open from a specific calendar date to use "Delete all future transactions".');
      if (!confirm("Delete this date and ALL future occurrences? Past dates stay on the schedule.")) return;
      await api(
        `/api/families/${state.activeFamilyId}/expected-transactions/${expectedId}/end-from-occurrence/${occ}`,
        "POST"
      );
    }

    closeExpectedDeleteModal();
    closeTxEditModal();
    await refreshExpectedCalendarAndMonth();
  } catch (e) {
    show(expectedDeleteErr, e.message || "Failed to delete");
  }
}

if (expectedDeleteAllBtn) {
  expectedDeleteAllBtn.addEventListener("click", () => runExpectedDeleteAction("all"));
}
if (expectedDeleteThisBtn) {
  expectedDeleteThisBtn.addEventListener("click", () => runExpectedDeleteAction("this"));
}
if (expectedDeleteFutureBtn) {
  expectedDeleteFutureBtn.addEventListener("click", () => runExpectedDeleteAction("future"));
}

if (reconcileSaveBtn) {
  reconcileSaveBtn.addEventListener("click", async () => {
    try {
      show(reconcileErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const iso = normalizeIsoDate(reconcileActiveDate);
      if (!iso) throw new Error("Invalid date");
      const month = (calendarMonth?.value || monthInput.value) || iso.slice(0, 7);
      await api(`/api/families/${state.activeFamilyId}/reconciled-days`, "POST", {
        date: iso,
        reconciled: !!reconcileChecked?.checked,
      });
      await loadReconciledDays(month);
      closeReconcileModal();
      renderCalendar();
    } catch (e) {
      show(reconcileErr, e.message || "Failed to save");
    }
  });
}

// Series panel save removed (replaced with "Update all series" in instance editor).

if (expectedEditDelete) {
  expectedEditDelete.addEventListener("click", () => {
    const id = expectedEditId?.value || null;
    const occ = selectedExpectedInstance ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) : null;
    openExpectedDeleteModal(id, occ);
  });
}

function parseIsoDateLocal(iso) {
  const n = normalizeIsoDate(iso);
  if (!n) return null;
  const y = Number(n.slice(0, 4));
  const m = Number(n.slice(5, 7));
  const d = Number(n.slice(8, 10));
  if (!y || !m || !d) return null;
  // Midday avoids DST edge cases around midnight.
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function endOfMonthDay(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function recurrenceLabel(value) {
  const v = String(value || "");
  if (v === "yearly") return "Annual";
  if (v === "semiannual") return "Twice yearly";
  if (v === "twice_monthly") return "Twice monthly";
  if (v === "weekly") return "Weekly";
  if (v === "monthly") return "Monthly";
  if (v === "once") return "Once";
  return v || "—";
}

function dateFromYMDClamped(year, monthIndex0, day) {
  const last = endOfMonthDay(year, monthIndex0);
  const d = Math.min(Math.max(1, Number(day) || 1), last);
  return new Date(year, monthIndex0, d, 12, 0, 0, 0);
}

function addMonthsClamped(d, months, dom) {
  const y = d.getFullYear();
  const m0 = d.getMonth() + Number(months);
  const year = y + Math.floor(m0 / 12);
  const monthIndex0 = ((m0 % 12) + 12) % 12;
  return dateFromYMDClamped(year, monthIndex0, dom);
}

function nextExpectedOccurrenceIso(tx, fromIso) {
  const start = parseIsoDateLocal(tx.start_date);
  if (!start) return null;
  const from = parseIsoDateLocal(fromIso) || start;
  const end = parseIsoDateLocal(tx.end_date || "");

  const startDom = start.getDate();
  const startMonth = start.getMonth(); // 0-11
  const startDow = start.getDay(); // 0-6
  const recurrence = String(tx.recurrence || "monthly");

  let cand = null;
  if (recurrence === "once") {
    cand = start >= from ? start : null;
  } else if (recurrence === "weekly") {
    if (from <= start) {
      cand = start;
    } else {
      const diffDays = Math.floor((from - start) / (24 * 3600 * 1000));
      const mod = ((diffDays % 7) + 7) % 7;
      const add = mod === 0 ? 0 : 7 - mod;
      cand = new Date(from);
      cand.setDate(from.getDate() + add);
      cand.setHours(12, 0, 0, 0);
      // Ensure weekday matches original schedule.
      if (cand.getDay() !== startDow) {
        const delta = (startDow - cand.getDay() + 7) % 7;
        cand.setDate(cand.getDate() + delta);
      }
    }
  } else if (recurrence === "twice_monthly") {
    const second = Number(tx.second_day_of_month);
    const days = [startDom, second].filter((n) => Number.isFinite(n) && n >= 1 && n <= 31).sort((a, b) => a - b);
    if (days.length === 0) return null;
    const y = from.getFullYear();
    const m0 = from.getMonth();
    const todayDom = from.getDate();
    const pick = days.find((d) => d >= todayDom);
    if (from <= start) {
      cand = start;
    } else if (pick != null) {
      cand = dateFromYMDClamped(y, m0, pick);
    } else {
      cand = dateFromYMDClamped(y, m0 + 1, days[0]);
    }
  } else if (recurrence === "yearly") {
    const y = from.getFullYear();
    const thisYear = dateFromYMDClamped(y, startMonth, startDom);
    cand = thisYear >= from ? thisYear : dateFromYMDClamped(y + 1, startMonth, startDom);
  } else if (recurrence === "semiannual") {
    // Every 6 months from start.
    if (from <= start) {
      cand = start;
    } else {
      let cur = start;
      // Jump close using month difference, then step by 6.
      const monthsDiff = (from.getFullYear() - start.getFullYear()) * 12 + (from.getMonth() - start.getMonth());
      const steps = Math.max(0, Math.floor(monthsDiff / 6) * 6);
      cur = addMonthsClamped(start, steps, startDom);
      while (cur < from) cur = addMonthsClamped(cur, 6, startDom);
      cand = cur;
    }
  } else {
    // monthly (default)
    if (from <= start) {
      cand = start;
    } else {
      const y = from.getFullYear();
      const m0 = from.getMonth();
      const thisMonth = dateFromYMDClamped(y, m0, startDom);
      cand = thisMonth >= from ? thisMonth : dateFromYMDClamped(y, m0 + 1, startDom);
    }
  }

  if (!cand) return null;
  if (cand < start) cand = start;
  if (end && cand > end) return null;
  return toISODate(cand);
}

/** Display amount / variable / kind / description for the next occurrence (API override-aware). */
function effectiveNextOccurrenceListFields(tx) {
  const rawAmt = tx && tx.next_occurrence_amount;
  const hasApiAmt = rawAmt != null && rawAmt !== "" && Number.isFinite(Number(rawAmt));
  const amount = hasApiAmt ? Number(rawAmt) : Number(tx && tx.amount) || 0;
  const variable =
    tx && typeof tx.next_occurrence_variable === "boolean" ? !!tx.next_occurrence_variable : !!(tx && tx.variable);
  const kind =
    tx && tx.next_occurrence_kind != null && String(tx.next_occurrence_kind).trim() !== ""
      ? String(tx.next_occurrence_kind)
      : String((tx && tx.kind) || "expense");
  const description =
    tx && tx.next_occurrence_description != null && String(tx.next_occurrence_description).trim() !== ""
      ? String(tx.next_occurrence_description).trim()
      : String((tx && tx.description) || "").trim() || "(no description)";
  return { amount, variable, kind, description };
}

/** Prefer API override-aware date; fall back to client schedule math for older backends. */
function nextOccurrenceIsoForRecurringList(tx, todayIso) {
  const raw = tx && tx.next_occurrence_date;
  if (raw != null && String(raw).trim() !== "") {
    const n = normalizeIsoDate(raw);
    if (n) return n;
    const s = String(raw);
    if (s.length >= 10) return `${s.slice(0, 4)}-${s.slice(5, 7)}-${s.slice(8, 10)}`;
  }
  return nextExpectedOccurrenceIso(tx, todayIso);
}

function renderUpcomingTransactionsFiltered() {
  if (!txListMain) return;
  const kindSel = upcomingKindFilter ? String(upcomingKindFilter.value || "all") : "all";
  const srcSel = upcomingSourceFilter ? String(upcomingSourceFilter.value || "all") : "all";
  const freqSel = upcomingRecurrenceFilter ? String(upcomingRecurrenceFilter.value || "all") : "all";
  const startIso = upcomingStartDate?.value || toISODate(new Date());
  const endIso = upcomingEndDate?.value || "";

  const withinRange = (iso) => {
    if (!iso) return false;
    if (startIso && String(iso) < String(startIso)) return false;
    if (endIso && String(iso) > String(endIso)) return false;
    return true;
  };

  /** @type {{sortIso:string, type:"actual"|"expected", tx:any, nextIso?:string}[]} */
  const rows = [];

  if (srcSel === "all" || srcSel === "one_time") {
    for (const tx of state.upcomingActualItems || []) {
      const iso = normalizeIsoDate(tx?.date) || String(tx?.date || "");
      if (!withinRange(iso)) continue;
      if (kindSel !== "all" && String(tx?.kind || "expense") !== kindSel) continue;
      rows.push({ sortIso: iso, type: "actual", tx });
    }
  }

  if (srcSel === "all" || srcSel === "recurring") {
    const todayIso = toISODate(new Date());
    const items = state.expectedTransactions || [];
    const byId = new Map();
    for (const tx of items) {
      const id = Number(tx && tx.id);
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, tx);
    }
    for (const tx of byId.values()) {
      const rec = String(tx?.recurrence || "monthly");
      if (srcSel === "recurring" && freqSel !== "all" && rec !== freqSel) continue;
      if (srcSel !== "recurring" && freqSel !== "all" && rec !== freqSel) {
        // Allow frequency filter even when "all" sources (applies to recurring rows only).
      }
      if (freqSel !== "all" && rec !== freqSel) continue;
      const eff = effectiveNextOccurrenceListFields(tx);
      if (kindSel !== "all" && String(eff.kind || "expense") !== kindSel) continue;
      const nextIso = nextOccurrenceIsoForRecurringList(tx, todayIso);
      if (!withinRange(nextIso)) continue;
      rows.push({ sortIso: nextIso, type: "expected", tx, nextIso });
    }
  }

  rows.sort((a, b) => String(a.sortIso).localeCompare(String(b.sortIso)));

  txListMain.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No upcoming transactions for these filters.";
    txListMain.appendChild(empty);
    return;
  }

  for (const r of rows) {
    if (r.type === "actual") {
      const tx = r.tx;
      const el = document.createElement("div");
      el.className = "item";
      el.style.cursor = "pointer";

      const amtClass = tx.kind === "income" ? "income" : "expense";
      const left = document.createElement("div");
      left.className = "left";
      const link = document.createElement("a");
      link.href = "#";
      link.className = `desc tx-desc-link ${kindFgClass(tx.kind)}`;
      link.textContent = (tx.description || "(no description)").trim() || "(no description)";
      const n = tx.notes && String(tx.notes).trim();
      if (n) link.title = n;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTxEditModal(tx);
      });
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.appendChild(document.createTextNode(fmtDateMDY(tx.date || "")));
      if (tx.category_id && tx.category) {
        const st = categoryPillStyleFromId(tx.category_id);
        const pill = document.createElement("span");
        pill.className = `cat-pill ${kindFgClass(tx.kind)}`;
        pill.textContent = tx.category;
        if (st?.fg) pill.style.color = st.fg;
        if (st?.bg) {
          pill.style.background = st.bg;
          pill.style.fontWeight = "600";
        }
        meta.appendChild(document.createTextNode(" · "));
        meta.appendChild(pill);
      } else if (tx.category) {
        meta.appendChild(document.createTextNode(` · ${tx.category}`));
      }
      left.appendChild(link);
      left.appendChild(meta);

      const amt = document.createElement("div");
      amt.className = `amt ${amtClass}`;
      amt.textContent = `${tx.kind === "income" ? "+" : "-"}$${fmtMoney(tx.amount)}`;

      el.appendChild(left);
      el.appendChild(amt);
      el.addEventListener("click", () => openTxEditModal(tx));
      txListMain.appendChild(el);
      continue;
    }

    const tx = r.tx;
    const nextIso = r.nextIso;
    const eff = effectiveNextOccurrenceListFields(tx);
    const el = document.createElement("div");
    el.className = "item expected-item--dense";
    if (eff.variable) el.classList.add("expected-item--variable");
    el.style.cursor = "pointer";
    el.title = `Recurring schedule #${tx.id} · next ${nextIso}`;

    const amtClass = eff.kind === "income" ? "income" : "expense";
    const kindSign = eff.kind === "income" ? "+" : "-";
    const left = document.createElement("div");
    left.className = "left";
    const descEl = document.createElement("div");
    descEl.className = `desc ${kindFgClass(eff.kind)}`;
    descEl.textContent = eff.description;
    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.appendChild(
      document.createTextNode(`Next: ${fmtDateMDY(nextIso)} · recurs: ${recurrenceLabel(tx.recurrence || "monthly")}`),
    );
    left.appendChild(descEl);
    left.appendChild(metaEl);
    const amtBtn = document.createElement("button");
    amtBtn.type = "button";
    amtBtn.className = `amt ${amtClass} expected-amt-link`;
    amtBtn.textContent = `${kindSign}$${fmtMoney(eff.amount)}`;
    amtBtn.title = "Edit recurring transaction";
    amtBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExpectedEditModal(tx, { nextOccurrenceIso: nextIso });
    });
    el.appendChild(left);
    el.appendChild(amtBtn);
    el.addEventListener("click", () => openExpectedEditModal(tx, { nextOccurrenceIso: nextIso }));
    txListMain.appendChild(el);
  }
}

function renderRecurringFilteredList() {
  if (!recurringFilteredList) return;
  const items = state.expectedTransactions || [];
  recurringFilteredList.innerHTML = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No recurring transactions yet.";
    recurringFilteredList.appendChild(empty);
    return;
  }

  const sel = recurringFrequencyFilter ? String(recurringFrequencyFilter.value || "all") : "all";
  const kindSel = recurringKindFilter ? String(recurringKindFilter.value || "all") : "all";
  const todayIso = toISODate(new Date());
  // Ensure one row per series id, even if items contain duplicates.
  const byId = new Map();
  for (const tx of items) {
    const id = Number(tx && tx.id);
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, tx);
  }

  const filtered = [...byId.values()]
    .filter(
      (tx) =>
        (sel === "all" || String(tx.recurrence || "monthly") === sel) &&
        (kindSel === "all" || String(tx.kind || "expense") === kindSel),
    )
    .map((tx) => ({ tx, nextIso: nextOccurrenceIsoForRecurringList(tx, todayIso) }))
    .filter((row) => !!row.nextIso);

  filtered.sort((a, b) => {
    const d = String(a.nextIso).localeCompare(String(b.nextIso));
    if (d !== 0) return d;
    return String(a.tx.description || "").localeCompare(String(b.tx.description || ""));
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No matching recurring transactions.";
    recurringFilteredList.appendChild(empty);
    return;
  }

  for (const { tx, nextIso } of filtered) {
    const eff = effectiveNextOccurrenceListFields(tx);
    const el = document.createElement("div");
    el.className = "item expected-item--dense";
    if (eff.variable) el.classList.add("expected-item--variable");
    el.style.cursor = "pointer";
    el.title = `Recurring schedule #${tx.id} · next ${nextIso}`;

    const amtClass = eff.kind === "income" ? "income" : "expense";
    const kindSign = eff.kind === "income" ? "+" : "-";
    const startDom =
      tx.start_date != null && String(tx.start_date).length >= 10
        ? Number(String(tx.start_date).slice(8, 10))
        : null;
    const twiceMeta =
      tx.recurrence === "twice_monthly" && tx.second_day_of_month != null && startDom != null && !Number.isNaN(startDom)
        ? `days ${startDom} & ${tx.second_day_of_month}`
        : "";

    const left = document.createElement("div");
    left.className = "left";
    const descEl = document.createElement("div");
    descEl.className = `desc ${kindFgClass(eff.kind)}`;
    descEl.textContent = eff.description;

    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    const bits = [`Next: ${fmtDateMDY(nextIso)}`, twiceMeta, tx.recurrence ? `recurs: ${recurrenceLabel(tx.recurrence)}` : ""].filter(Boolean);
    metaEl.appendChild(document.createTextNode(bits.join(" ")));

    left.appendChild(descEl);
    left.appendChild(metaEl);

    const amtBtn = document.createElement("button");
    amtBtn.type = "button";
    amtBtn.className = `amt ${amtClass} expected-amt-link`;
    amtBtn.textContent = `${kindSign}$${fmtMoney(eff.amount)}`;
    amtBtn.title = "Edit recurring transaction";
    amtBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExpectedEditModal(tx, { nextOccurrenceIso: nextIso });
    });

    el.appendChild(left);
    el.appendChild(amtBtn);
    el.addEventListener("click", () => openExpectedEditModal(tx, { nextOccurrenceIso: nextIso }));
    recurringFilteredList.appendChild(el);
  }
}

async function loadExpectedTransactions() {
  if (!state.activeFamilyId) return;
  const items = await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "GET");
  state.expectedTransactions = items || [];
  renderUpcomingTransactionsFiltered();
}

function renderProjectionSummary(summary) {
  projectionSummary.innerHTML = "";
  if (!summary?.daily || summary.daily.length === 0) return;

  const first = summary.daily[0];
  const last = summary.daily[summary.daily.length - 1];

  const startBal = Number(first.total_balance ?? 0);
  const endBal = Number(last.total_balance ?? 0);
  const net = endBal - startBal;

  const startEl = document.createElement("div");
  startEl.className = "total";
  startEl.innerHTML = `<div class="k">Start balance</div><div class="v">$${fmtMoney(startBal)}</div>`;

  const endEl = document.createElement("div");
  endEl.className = "total";
  endEl.innerHTML = `<div class="k">End balance</div><div class="v">$${fmtMoney(endBal)}</div>`;

  const netEl = document.createElement("div");
  netEl.className = "total";
  netEl.innerHTML = `<div class="k">Net cashflow</div><div class="v ${net >= 0 ? "ok" : "danger"}">$${fmtMoney(net)}</div>`;

  projectionSummary.appendChild(startEl);
  projectionSummary.appendChild(endEl);
  projectionSummary.appendChild(netEl);
}

function renderProjectionDaily(dailyItems) {
  projectionDailyList.innerHTML = "";
  if (!dailyItems || dailyItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No projection data.";
    projectionDailyList.appendChild(empty);
    return;
  }

  for (const d of dailyItems) {
    const el = document.createElement("div");
    el.className = "item";

    const netNum = Number(d.net_cashflow ?? 0);
    const amtClass = netNum >= 0 ? "income" : "expense";
    const kindSign = netNum >= 0 ? "+" : "-";

    let balancesMeta = "";
    if (d.account_balance && state.accounts && state.accounts.length > 0) {
      const pairs = [];
      for (const a of state.accounts) {
        const key = String(a.id);
        const bal = d.account_balance[key] ?? 0;
        pairs.push(`${a.name}: $${fmtMoney(bal)}`);
        if (pairs.length >= 3) break;
      }
      balancesMeta = `Balances: ${pairs.join(", ")}`;
    }

    el.innerHTML = `
      <div class="left">
        <div class="desc">${fmtDateMDY(d.date)}</div>
        <div class="meta">Total balance: $${fmtMoney(d.total_balance)}${balancesMeta ? ` · ${escapeHtml(balancesMeta)}` : ""}</div>
      </div>
      <div class="amt ${amtClass}">${kindSign}$${fmtMoney(Math.abs(netNum))}</div>
    `;

    projectionDailyList.appendChild(el);
  }
}

function renderTotals(totals) {
  totalsEl.innerHTML = "";
  const income = totals?.income ?? 0;
  const expense = totals?.expense ?? 0;
  const net = totals?.net ?? 0;

  const incomeEl = document.createElement("div");
  incomeEl.className = "total";
  incomeEl.innerHTML = `<div class="k">Income</div><div class="v ok">$${fmtMoney(income)}</div>`;

  const expenseEl = document.createElement("div");
  expenseEl.className = "total";
  expenseEl.innerHTML = `<div class="k">Expense</div><div class="v danger">$${fmtMoney(expense)}</div>`;

  const netEl = document.createElement("div");
  netEl.className = "total";
  netEl.innerHTML = `<div class="k">Net</div><div class="v ${net >= 0 ? "ok" : "danger"}">$${fmtMoney(net)}</div>`;

  totalsEl.appendChild(incomeEl);
  totalsEl.appendChild(expenseEl);
  totalsEl.appendChild(netEl);
}

function computeMonthSummaryTotalsFromState() {
  const mode = calendarMode?.value || "both";
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";

  let income = 0;
  let expense = 0;

  if (includeActual) {
    for (const tx of state.monthActualItems || []) {
      const amt = toNum(tx.amount);
      if (!Number.isFinite(amt)) continue;
      if (String(tx.kind) === "income") income += amt;
      else expense += amt;
    }
  }

  if (includeExpected) {
    for (const tx of state.monthExpectedItems || []) {
      const amt = toNum(tx.amount);
      if (!Number.isFinite(amt)) continue;
      if (String(tx.kind) === "income") income += amt;
      else expense += amt;
    }
  }

  return { income, expense, net: income - expense };
}

function renderMonthSummaryTotalsFromState() {
  renderTotals(computeMonthSummaryTotalsFromState());
}

function renderTransactionsInto(listEl, items, emptyMessage) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = emptyMessage || "No transactions for this month.";
    listEl.appendChild(empty);
    return;
  }

  for (const tx of items) {
    const el = document.createElement("div");
    el.className = "item";
    el.style.cursor = "pointer";

    const amtClass = tx.kind === "income" ? "income" : "expense";

    const left = document.createElement("div");
    left.className = "left";
    const link = document.createElement("a");
    link.href = "#";
    link.className = `desc tx-desc-link ${kindFgClass(tx.kind)}`;
    link.textContent = (tx.description || "(no description)").trim() || "(no description)";
    const n = tx.notes && String(tx.notes).trim();
    if (n) link.title = n;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTxEditModal(tx);
    });

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.appendChild(document.createTextNode(fmtDateMDY(tx.date || "")));
    if (tx.category_id && tx.category) {
      const st = categoryPillStyleFromId(tx.category_id);
      const pill = document.createElement("span");
      pill.className = `cat-pill ${kindFgClass(tx.kind)}`;
      pill.textContent = tx.category;
      if (st?.fg) pill.style.color = st.fg;
      if (st?.bg) {
        pill.style.background = st.bg;
        pill.style.fontWeight = "600";
      }
      meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(pill);
    } else if (tx.category) {
      meta.appendChild(document.createTextNode(` · ${tx.category}`));
    }

    left.appendChild(link);
    left.appendChild(meta);

    const amt = document.createElement("div");
    amt.className = `amt ${amtClass}`;
    amt.textContent = `${tx.kind === "income" ? "+" : "-"}$${fmtMoney(tx.amount)}`;

    el.appendChild(left);
    el.appendChild(amt);
    el.addEventListener("click", () => openTxEditModal(tx));
    listEl.appendChild(el);
  }
}

function renderTransactions(items) {
  renderTransactionsInto(txList, items, "No transactions for this month.");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadTransactions() {
  try {
    show(txErr, "");
    if (!state.activeFamilyId) return;
    const month = monthInput.value;
    const qs = month ? `?month=${encodeURIComponent(month)}` : "";
    const data = await api(`/api/families/${state.activeFamilyId}/transactions${qs}`, "GET");
    const items = data?.items || [];
    state.monthActualItems = items;
    renderTransactions(items);
  } catch (e) {
    show(txErr, e.message || "Failed to load transactions");
  }
}

/** Actual transactions on or after today (for Transaction View list), chronological. */
async function loadUpcomingTransactionsPanel() {
  try {
    if (!state.activeFamilyId) {
      state.upcomingActualItems = [];
      renderUpcomingTransactionsFiltered();
      return;
    }
    const todayIso = upcomingStartDate?.value || toISODate(new Date());
    const endIso = upcomingEndDate?.value || (() => {
      const endCap = new Date();
      endCap.setDate(endCap.getDate() + 548);
      return toISODate(endCap);
    })();
    const qs = `?start_date=${encodeURIComponent(todayIso)}&end_date=${encodeURIComponent(endIso)}`;
    const data = await api(`/api/families/${state.activeFamilyId}/transactions${qs}`, "GET");
    const items = data?.items || [];
    state.upcomingActualItems = items;
    renderUpcomingTransactionsFiltered();
  } catch (e) {
    show(txErr, e.message || "Failed to load upcoming transactions");
  }
}

async function loadExpectedCalendar() {
  try {
    show(calendarErr, "");
    state.monthExpectedItems = [];
    if (!state.activeFamilyId) return;

    const month = calendarMonth?.value || monthInput.value;
    if (!month) return;

    const data = await api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(month)}`, "GET");
    state.monthExpectedItems = data?.items || [];
  } catch (e) {
    show(calendarErr, e.message || "Failed to load expected calendar");
  }
  renderVariableTodosForMonth();
}

function shiftMonthStr(ym, deltaMonths) {
  const p = String(ym || "").split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function loadCalendarExtras() {
  state.calendarExtraActualItems = [];
  state.calendarExtraExpectedItems = [];
  if (!state.activeFamilyId) return;
  const month = calendarMonth?.value || monthInput.value;
  if (!month) return;
  const prev = shiftMonthStr(month, -1);
  const next = shiftMonthStr(month, 1);
  if (!prev || !next) return;
  try {
    const [prevTx, nextTx] = await Promise.all([
      api(`/api/families/${state.activeFamilyId}/transactions?month=${encodeURIComponent(prev)}`, "GET"),
      api(`/api/families/${state.activeFamilyId}/transactions?month=${encodeURIComponent(next)}`, "GET"),
    ]);
    state.calendarExtraActualItems = [...(prevTx?.items || []), ...(nextTx?.items || [])];
  } catch (_) {
    // Non-fatal; calendar will still render the base month.
    state.calendarExtraActualItems = [];
  }
  try {
    const [prevExp, nextExp] = await Promise.all([
      api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(prev)}`, "GET"),
      api(`/api/families/${state.activeFamilyId}/expected-calendar?month=${encodeURIComponent(next)}`, "GET"),
    ]);
    state.calendarExtraExpectedItems = [...(prevExp?.items || []), ...(nextExp?.items || [])];
  } catch (_) {
    state.calendarExtraExpectedItems = [];
  }
}

/** Normalize API/legacy dates to YYYY-MM-DD for Map keys. */
function normalizeIsoDate(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

async function loadReconciledDays(month) {
  state.reconciledDates = new Set();
  if (!state.activeFamilyId) return;
  if (!month) return;
  try {
    const data = await api(
      `/api/families/${state.activeFamilyId}/reconciled-days?month=${encodeURIComponent(month)}`,
      "GET"
    );
    const ds = data?.dates || [];
    for (const d of ds) {
      const iso = normalizeIsoDate(d);
      if (iso) state.reconciledDates.add(iso);
    }
  } catch (_) {
    state.reconciledDates = new Set();
  }
}

async function loadCalendarMonthDaily() {
  state.monthDailyBalances = new Map();
  if (!state.activeFamilyId) return;
  const month = calendarMonth?.value || monthInput.value;
  if (!month) return;
  const mode = calendarMode?.value || "both";
  try {
    const data = await api(
      `/api/families/${state.activeFamilyId}/calendar-month-daily?month=${encodeURIComponent(month)}&mode=${encodeURIComponent(mode)}`,
      "GET",
    );
    const days = data?.days;
    if (Array.isArray(days) && days.length > 0) {
      for (const row of days) {
        const iso = normalizeIsoDate(row.date);
        if (!iso) continue;
        const start = Number(row.start);
        const txNet = Number(row.tx_net);
        const end = Number(row.end);
        state.monthDailyBalances.set(iso, {
          start: Number.isFinite(start) ? start : 0,
          txNet: Number.isFinite(txNet) ? txNet : 0,
          end: Number.isFinite(end) ? end : 0,
        });
      }
      // Also compute balances for visible "wrap" days (prev/next month) if needed.
      const wrap = computeCalendarVisibleDailyBalancesClient();
      for (const [iso, row] of wrap.entries()) {
        if (!state.monthDailyBalances.has(iso)) state.monthDailyBalances.set(iso, row);
      }
      return;
    }
  } catch (_) {
    /* offline or old API — fall back */
  }
  computeMonthDailyBalancesLegacy();
}

function setCalendarLoadingUi(on) {
  const panel = document.getElementById("calendarPanel");
  if (panel) {
    panel.classList.toggle("calendar-panel--loading", !!on);
    panel.setAttribute("aria-busy", on ? "true" : "false");
  }
  for (const el of [calendarPrevMonth, calendarNextMonth, calendarGoToday, calendarMonthNum, calendarYear, calendarMode]) {
    if (el) el.disabled = !!on;
  }
}

async function loadMonthAndCalendar() {
  if (!state.activeFamilyId) return;
  try {
    setCalendarLoadingUi(true);
    state.monthActualItems = [];
    state.monthExpectedItems = [];
    state.calendarExtraActualItems = [];
    state.calendarExtraExpectedItems = [];
    state.monthDailyBalances = new Map();
    state.reconciledDates = new Set();
    renderCalendar();

    await loadTransactions();
    await loadUpcomingTransactionsPanel();
    await loadExpectedCalendar();
    renderMonthSummaryTotalsFromState();
    await loadCalendarExtras();
    await loadReconciledDays(calendarMonth?.value || monthInput.value);
    await loadCalendarMonthDaily();
    renderCalendar();
    await refreshLowBalanceAlert();
  } catch (e) {
    show(calendarErr, e.message || "Failed to load calendar");
  } finally {
    setCalendarLoadingUi(false);
  }
}

/** Client-only fallback when calendar-month-daily API is unavailable (approximate). */
function computeMonthDailyBalancesLegacy() {
  state.monthDailyBalances = computeCalendarVisibleDailyBalancesClient();
}

function computeCalendarVisibleDailyBalancesClient() {
  const out = new Map();
  const month = calendarMonth?.value || monthInput.value;
  if (!month) return out;
  const [yearPart, monthPart] = String(month).split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthStartIso = dateISOFromParts(year, monthIndex, 1);

  // Determine the visible calendar grid range (includes wrap days).
  const first = new Date(year, monthIndex, 1);
  const offset = first.getDay(); // Sunday=0
  let weekRows = Math.ceil((offset + daysInMonth) / 7); // 4–6
  let totalCells = weekRows * 7;
  if (totalCells === 42) {
    let lastRowHasInMonth = false;
    for (let i = 35; i < 42; i++) {
      const dayNum = i - offset + 1;
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        lastRowHasInMonth = true;
        break;
      }
    }
    if (!lastRowHasInMonth) {
      weekRows = 5;
      totalCells = 35;
    }
  }
  const rangeStart = new Date(year, monthIndex, 1 - offset);
  const rangeEnd = new Date(year, monthIndex, 1 - offset + (totalCells - 1));

  const mode = calendarMode?.value || "both";
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";

  const dailyTxnTotals = new Map();
  const startAdds = new Map();
  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    dailyTxnTotals.set(iso, 0);
    startAdds.set(iso, 0);
  }

  if (includeActual) {
    for (const tx of [...(state.monthActualItems || []), ...(state.calendarExtraActualItems || [])]) {
      const amt = Number(tx.amount || 0);
      const signed = tx.kind === "income" ? amt : -amt;
      const dk = normalizeIsoDate(tx.date) || tx.date;
      dailyTxnTotals.set(dk, (dailyTxnTotals.get(dk) || 0) + signed);
    }
  }
  if (includeExpected) {
    for (const tx of [...(state.monthExpectedItems || []), ...(state.calendarExtraExpectedItems || [])]) {
      const amt = Number(tx.amount || 0);
      const signed = tx.kind === "income" ? amt : -amt;
      const dk = normalizeIsoDate(tx.date) || tx.date;
      dailyTxnTotals.set(dk, (dailyTxnTotals.get(dk) || 0) + signed);
    }
  }

  let carry = 0;
  const rangeStartIso = toISODate(rangeStart);
  for (const account of state.accounts || []) {
    const startBal = Number(account.starting_balance || 0);
    const startDate = normalizeIsoDate(account.starting_balance_date) || account.starting_balance_date || monthStartIso;
    if (startDate < rangeStartIso) {
      carry += startBal;
    } else if (startAdds.has(startDate)) {
      startAdds.set(startDate, (startAdds.get(startDate) || 0) + startBal);
    }
  }

  for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    const dayStart = carry + (startAdds.get(iso) || 0);
    const txNet = dailyTxnTotals.get(iso) || 0;
    const dayEnd = dayStart + txNet;
    out.set(iso, { start: dayStart, txNet, end: dayEnd });
    carry = dayEnd;
  }

  return out;
}

function truncate(s, maxLen) {
  const str = String(s ?? "");
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function renderVariableTodosForMonth() {
  if (!variableTodoList) return;
  const items = state.monthExpectedItems || [];
  variableTodoList.innerHTML = "";
  const variableItems = items.filter((it) => !!it && !!it.variable);
  if (variableItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No variable items this month.";
    variableTodoList.appendChild(empty);
    return;
  }

  variableItems.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  for (const it of variableItems) {
    const el = document.createElement("div");
    el.className = "item expected-item--dense expected-item--variable";
    el.style.cursor = "pointer";

    const left = document.createElement("div");
    left.className = "left";

    const descEl = document.createElement("div");
    descEl.className = `desc ${kindFgClass(it.kind)}`;
    descEl.textContent = truncate(it.description || "(expected)", 32);

    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.textContent = it.date ? fmtDateMDY(it.date) : "—";

    left.appendChild(descEl);
    left.appendChild(metaEl);

    const amtBtn = document.createElement("button");
    amtBtn.type = "button";
    amtBtn.className = `amt ${it.kind === "income" ? "income" : "expense"} expected-amt-link`;
    amtBtn.textContent = `$${fmtMoney(it.amount)}`;
    amtBtn.title = "Review / edit this recurring occurrence";

    el.appendChild(left);
    el.appendChild(amtBtn);

    el.addEventListener("click", () => {
      const meta = getExpectedSeriesMeta(it.expected_transaction_id);
      if (meta) openExpectedEditModal(meta, { calendarItem: it });
    });

    variableTodoList.appendChild(el);
  }
}

function getExpectedSeriesMeta(expectedId) {
  return (state.expectedTransactions || []).find((t) => Number(t.id) === Number(expectedId));
}

/** Description for recurring save payloads (label field removed from modal). */
function expectedSaveDescription() {
  const inst = selectedExpectedInstance;
  if (inst && inst.description != null && String(inst.description).trim() !== "") {
    return String(inst.description).trim().slice(0, 500);
  }
  const meta =
    selectedExpectedSeriesTx ||
    (inst && getExpectedSeriesMeta(inst.expected_transaction_id)) ||
    getExpectedSeriesMeta(Number(expectedEditId?.value || 0));
  return String(meta?.description || "").trim().slice(0, 500);
}

function dateISOFromParts(year, monthIndex0Based, day) {
  const y = year;
  const m = String(monthIndex0Based + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function selectExpectedInstance(item) {
  const occ = item.occurrence_date ? normalizeIsoDate(item.occurrence_date) : normalizeIsoDate(item.date);
  selectedExpectedInstance = {
    expected_transaction_id: item.expected_transaction_id,
    occurrence_date: occ || item.date,
    description: item.description != null ? String(item.description) : "",
  };

  if (txEditDate) {
    txEditDate.readOnly = false;
    txEditDate.disabled = false;
    selectedExpectedMovedToDate = normalizeIsoDate(item.date) || item.date;
    txEditDate.value = selectedExpectedMovedToDate;
  }
  if (instanceExpectedTxId) instanceExpectedTxId.value = String(item.expected_transaction_id);
  {
    const k = item && item.kind ? String(item.kind) : "expense";
    const radio = document.querySelector(`input[type="radio"][name="txEditKind"][value="${k}"]`);
    if (radio) radio.checked = true;
  }
  if (txEditAmount) txEditAmount.value = Number(item.amount);
  if (txEditNotes) txEditNotes.value = item.notes && String(item.notes).trim() ? String(item.notes).trim() : "";
  if (instanceAccountId) instanceAccountId.value = String(item.account_id);
  setCategoryFieldValue("txEditCategoryId", item.category_id);

  {
    const meta = selectedExpectedSeriesTx || getExpectedSeriesMeta(item.expected_transaction_id);
    if (meta) {
      if (instanceRecurrence) instanceRecurrence.value = String(meta.recurrence || "monthly");
      if (instanceSecondDayOfMonth) instanceSecondDayOfMonth.value = meta.second_day_of_month != null ? String(meta.second_day_of_month) : "";
      updateInstanceTwiceMonthlyVisibility();
    }
  }

  show(txEditErr, "");
}

function renderCalendar() {
  if (!calendarGrid) return;
  calendarGrid.innerHTML = "";
  const calendarDow = document.getElementById("calendarDow");
  if (calendarDow) calendarDow.innerHTML = "";

  const month = calendarMonth?.value || monthInput.value;
  if (!month || !state.activeFamilyId) return;

  const parts = String(month).split("-");
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;

  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const offset = first.getDay(); // Sunday=0

  const mode = calendarMode?.value || "both";
  const showActual = mode === "both" || mode === "actual";
  const showExpected = mode === "both" || mode === "expected";

  const actualTxsByDate = new Map();
  for (const tx of [...(state.monthActualItems || []), ...(state.calendarExtraActualItems || [])]) {
    const dk = normalizeIsoDate(tx.date) || tx.date;
    if (!actualTxsByDate.has(dk)) actualTxsByDate.set(dk, []);
    actualTxsByDate.get(dk).push(tx);
  }

  const expectedByDate = new Map(); // iso -> [items]
  for (const item of [...(state.monthExpectedItems || []), ...(state.calendarExtraExpectedItems || [])]) {
    const key = normalizeIsoDate(item.date) || item.date;
    if (!expectedByDate.has(key)) expectedByDate.set(key, []);
    expectedByDate.get(key).push(item);
  }

  function txSortKeyKindFirst(tx) {
    // income (positive) first, then expense (negative)
    return String(tx.kind) === "income" ? 0 : 1;
  }

  function txSortAmountDesc(a, b) {
    const ak = txSortKeyKindFirst(a);
    const bk = txSortKeyKindFirst(b);
    if (ak !== bk) return ak - bk;
    const aa = Number(a.amount ?? 0);
    const ba = Number(b.amount ?? 0);
    if (ba !== aa) return ba - aa;
    // Prefer actual over expected when otherwise equal.
    const at = a && a._type === "expected" ? 1 : 0;
    const bt = b && b._type === "expected" ? 1 : 0;
    if (at !== bt) return at - bt;
    // stable-ish fallback for consistent ordering
    const ad = String(a.description || "");
    const bd = String(b.description || "");
    const dc = ad.localeCompare(bd);
    if (dc !== 0) return dc;
    const aid = Number(a.id ?? 0);
    const bid = Number(b.id ?? 0);
    return aid - bid;
  }

  // Sort transactions within each day.
  for (const arr of actualTxsByDate.values()) {
    arr.sort(txSortAmountDesc);
  }
  for (const arr of expectedByDate.values()) {
    arr.sort(txSortAmountDesc);
  }

  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const wrapper = document.createElement("div");
  wrapper.className = "calendar";

  if (calendarDow) {
    for (const label of dow) {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = label;
      calendarDow.appendChild(el);
    }
  }

  // Render only the weeks needed for this month.
  // If the 6th row would be entirely out-of-month, drop it (cap at 5 rows).
  let weekRows = Math.ceil((offset + daysInMonth) / 7); // 4–6
  let totalCells = weekRows * 7;
  if (totalCells === 42) {
    let lastRowHasInMonth = false;
    for (let i = 35; i < 42; i++) {
      const dayNum = i - offset + 1;
      if (dayNum >= 1 && dayNum <= daysInMonth) {
        lastRowHasInMonth = true;
        break;
      }
    }
    if (!lastRowHasInMonth) {
      weekRows = 5;
      totalCells = 35;
    }
  }
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell";

    const dayNum = i - offset + 1;
    const isOutOfMonth = dayNum < 1 || dayNum > daysInMonth;
    const dObj = new Date(year, monthIndex, dayNum);
    const iso = toISODate(dObj);
    cell.dataset.iso = iso;
    const todayIso = toISODate(new Date());
    const isToday = iso === todayIso;
    const isReconciled = state.reconciledDates && state.reconciledDates.has(iso);
    cell.innerHTML = `
      <div class="cal-daynum"><span class="cal-daynum-num${isToday ? " is-today" : ""}">${dObj.getDate()}</span>${isReconciled ? `
        <span class="cal-reconciled-mark" title="Reconciled" aria-label="Reconciled">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M8 12.5l2.6 2.6L16.5 9.2"></path>
          </svg>
        </span>` : ""}</div>
      <div class="cal-cell-fill"></div>
      <div class="cal-cell-stack">
        <div class="cal-day-txns"></div>
        <div class="cal-ledger-metrics"></div>
      </div>
    `;
    if (isOutOfMonth) cell.classList.add("cal-cell--out");
    const txnsEl = cell.querySelector(".cal-day-txns");
    const metricsEl = cell.querySelector(".cal-ledger-metrics");

    const dayNumEl = cell.querySelector(".cal-daynum");
    if (dayNumEl) {
      dayNumEl.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openReconcileModal(iso);
      });
    }

    const actualTxs = showActual ? actualTxsByDate.get(iso) || [] : [];
    const expectedItems = showExpected ? expectedByDate.get(iso) || [] : [];

    // Combine and sort expected + actual for consistent ordering per-day.
    const combined = [];
    for (const item of expectedItems) combined.push({ ...item, _type: "expected" });
    for (const tx of actualTxs) combined.push({ ...tx, _type: "actual" });
    combined.sort(txSortAmountDesc);

    for (const row of combined) {
      const isExpected = row._type === "expected";
      const line = document.createElement("div");
      line.className = isExpected
        ? "cal-day-tx-line cal-day-tx-line--expected"
        : "cal-day-tx-line cal-tx-part";
      if (isExpected && row.variable) line.classList.add("cal-expected-variable");
      if (!isExpected) line.dataset.txId = String(row.id);

      const labelRaw = isExpected ? row.description || "(expected)" : (row.description || "Transaction").trim();
      const label = truncate(labelRaw, 44);

      const labelSpan = document.createElement("span");
      labelSpan.className = `cal-tx-label ${kindFgClass(row.kind)}`;
      labelSpan.textContent = `${label} `;
      if (row.category_id && row.category) {
        const st = categoryPillStyleFromId(row.category_id);
        if (st?.fg) labelSpan.style.color = st.fg;
        if (st?.bg) labelSpan.style.background = st.bg;
        if (st?.bg) {
          labelSpan.style.padding = "1px 6px";
          labelSpan.style.borderRadius = "6px";
          labelSpan.style.border = "1px solid rgba(0,0,0,0.12)";
          labelSpan.style.fontWeight = "600";
        }
      }

      const labelWrap = document.createElement("span");
      labelWrap.className = "cal-tx-label-wrap";
      labelWrap.appendChild(labelSpan);

      const amtSpan = document.createElement("span");
      amtSpan.className = `cal-amt ${row.kind === "income" ? "income" : "expense"}`;
      amtSpan.textContent = `$${fmtMoney(row.amount)}`;

      line.appendChild(labelWrap);
      line.appendChild(amtSpan);

      {
        const headRaw = String(labelRaw || "").trim() || (isExpected ? "Expected" : "Transaction");
        const head = isExpected ? `Expected: ${headRaw}` : headRaw;
        const noteStr = row.notes && String(row.notes).trim() ? String(row.notes).trim() : "";
        const tt = noteStr ? `${head}\nNotes: ${noteStr}` : head;
        line.title = tt;
        labelWrap.title = tt;
        amtSpan.title = tt;
      }

      if (isExpected) {
        line.addEventListener("click", (e) => {
          e.stopPropagation();
          const meta = getExpectedSeriesMeta(row.expected_transaction_id);
          if (meta) openExpectedEditModal(meta, { calendarItem: row });
        });
      }

      txnsEl.appendChild(line);
    }

    const dayBal = state.monthDailyBalances.get(iso);

    if (dayBal && metricsEl) {
      const endNum = Number(dayBal.end ?? 0);
      const negClass = Number.isFinite(endNum) && endNum < 0 ? " is-negative" : "";
      metricsEl.innerHTML = `<div class="cal-stat cal-balance${negClass}">$${fmtMoneyParens(endNum)}</div>`;
    }

    wrapper.appendChild(cell);
  }

  calendarGrid.appendChild(wrapper);

  const calendarPanel = document.getElementById("calendarPanel");
  if (calendarPanel) {
    calendarPanel.style.setProperty("--cal-week-rows", String(weekRows));
    // Give 5-week months a bit more room so the bottom balance isn't clipped.
    const h = weekRows <= 4 ? "96px" : weekRows === 5 ? "130px" : "118px";
    calendarPanel.style.setProperty("--cal-day-min-h", h);
  }
}

function drawProjectionChart(daily) {
  const emptyEl = document.getElementById("projectionChartEmpty");
  if (!projectionChartCanvas) return;

  if (projectionChartInstance) {
    projectionChartInstance.destroy();
    projectionChartInstance = null;
  }

  const items = daily || [];
  if (items.length < 2) {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent =
        items.length === 0 ? "No data for this range." : "Not enough data points to draw the chart.";
    }
    return;
  }

  if (typeof Chart === "undefined") {
    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = "Chart library failed to load. Check your network connection.";
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  ensureProjectionChartDefaults();

  const dateLabels = items.map((d) => d.date);
  const values = items.map((d) => Number(d.total_balance ?? 0));

  const ctx = projectionChartCanvas.getContext("2d");
  if (!ctx) return;

  projectionChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: dateLabels,
      datasets: [
        {
          label: "Balance",
          data: values,
          borderColor: "rgba(102,163,255,0.95)",
          backgroundColor: "rgba(102,163,255,0.18)",
          borderWidth: 1.5,
          fill: true,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (ctxItems) => {
              const i = ctxItems[0]?.dataIndex ?? 0;
              return formatProjectionTooltipDate(dateLabels[i]);
            },
            label: (ctx) => ` Balance $${fmtMoney(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          type: "category",
          grid: { color: "rgba(0,0,0,0.06)", drawBorder: false },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 10,
            maxRotation: 0,
            callback: function (tickValue) {
              const lbl = typeof tickValue === "number" ? dateLabels[tickValue] : tickValue;
              if (lbl == null || lbl === "") return "";
              return formatProjectionAxisDate(String(lbl));
            },
          },
          title: {
            display: true,
            text: "Date",
            color: "#4b5563",
            font: { size: 11, weight: "500" },
            padding: { top: 6 },
          },
        },
        y: {
          grid: { color: "rgba(0,0,0,0.06)", drawBorder: false },
          ticks: {
            maxTicksLimit: 7,
            callback: (value) =>
              "$" +
              Number(value).toLocaleString(undefined, {
                maximumFractionDigits: 0,
                minimumFractionDigits: 0,
              }),
          },
          title: {
            display: true,
            text: "Balance",
            color: "#4b5563",
            font: { size: 11, weight: "500" },
          },
        },
      },
    },
  });
}

function setDefaultMonth() {
  initCalendarYearOptions();
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const ym = `${d.getFullYear()}-${m}`;
  monthInput.value = ym;
  applyCalendarMonthToPickers(ym);
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function setDefaultProjectionStart() {
  projectionStart.value = toISODate(new Date());
}

function setDefaultChartStart() {
  if (chartStart) chartStart.value = toISODate(new Date());
}

function setDefaultAccountStartDate() {
  if (accountStartingBalanceDate) accountStartingBalanceDate.value = toISODate(new Date());
}

async function main() {
  const apiBase = apiBaseUrl();
  if (location.hostname.endsWith("github.io") && !apiBase) {
    show(
      familiesErr,
      "GitHub Pages build is missing API_BASE. In the repo: Settings → Secrets → Actions → set API_BASE to your Render URL (e.g. https://your-app.onrender.com, no trailing slash), then re-run the workflow “Deploy frontend to GitHub Pages”."
    );
    if (userPill) userPill.textContent = "API not configured";
    return;
  }
  setDefaultMonth();
  setDefaultProjectionStart();
  setDefaultChartStart();
  setDefaultAccountStartDate();
  await loadMe();
  await loadFamilies();
  if (state.activeFamilyId) {
    await loadCategories();
    await loadAccounts();
    await loadExpectedTransactions();
    await loadMonthAndCalendar();
  }
  if (balanceThresholdMin || balanceThresholdMax) {
    try {
      const legacy = localStorage.getItem(LOW_BALANCE_THRESHOLD_KEY) || "";
      const minStored = localStorage.getItem(BALANCE_THRESHOLD_MIN_KEY) || "";
      if (legacy && !minStored && balanceThresholdMin && !balanceThresholdMin.value) {
        balanceThresholdMin.value = legacy;
        localStorage.setItem(BALANCE_THRESHOLD_MIN_KEY, legacy);
      } else {
        if (balanceThresholdMin) {
          const s = localStorage.getItem(BALANCE_THRESHOLD_MIN_KEY) || "";
          if (s && !balanceThresholdMin.value) balanceThresholdMin.value = s;
        }
        if (balanceThresholdMax) {
          const s2 = localStorage.getItem(BALANCE_THRESHOLD_MAX_KEY) || "";
          if (s2 && !balanceThresholdMax.value) balanceThresholdMax.value = s2;
        }
      }
    } catch (_) {}
    if (balanceThresholdMin) {
      balanceThresholdMin.addEventListener("input", scheduleLowBalanceRefresh);
      balanceThresholdMin.addEventListener("change", scheduleLowBalanceRefresh);
    }
    if (balanceThresholdMax) {
      balanceThresholdMax.addEventListener("input", scheduleLowBalanceRefresh);
      balanceThresholdMax.addEventListener("change", scheduleLowBalanceRefresh);
    }
    await refreshLowBalanceAlert();
  }
}

main().catch((e) => {
  if (userPill) userPill.textContent = "Not connected";
  const m = e.message || "Failed to load app";
  show(familiesErr, m);
  show(txErr, m);
});

