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
  monthExpectedItems: [],
  calendarExtraActualItems: [],
  calendarExtraExpectedItems: [],
  reconciledDates: new Set(),
  monthDailyBalances: new Map(),
};

let selectedExpectedInstance = null;
let selectedExpectedMovedToDate = null;

const userPill = document.getElementById("userPill");
const familiesErr = document.getElementById("familiesErr");
const txErr = document.getElementById("txErr");
const catErr = document.getElementById("catErr");
const addTxErr = document.getElementById("addTxErr");

const familySelect = document.getElementById("familySelect");
const monthInput = document.getElementById("monthInput");
const totalsEl = document.getElementById("totals");
const txList = document.getElementById("txList");

const categoriesGrid = document.getElementById("categoriesGrid");
const txCategoryId = document.getElementById("txCategoryId");

// Low balance alert
const lowBalanceThreshold = document.getElementById("lowBalanceThreshold");
const lowBalanceResult = document.getElementById("lowBalanceResult");
const lowBalanceErr = document.getElementById("lowBalanceErr");
const LOW_BALANCE_THRESHOLD_KEY = "familyCashFlow_lowBalanceThreshold";
let lowBalanceDebounceTimer = null;
let lowBalanceLastQuery = { familyId: null, threshold: null };

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

// Expected transactions
const expectedTxErr = document.getElementById("expectedTxErr");
const expectedTxList = document.getElementById("expectedTxList");
const expectedStartDate = document.getElementById("expectedStartDate");
const expectedLastTxnDate = document.getElementById("expectedLastTxnDate");
const expectedRecurrence = document.getElementById("expectedRecurrence");
const expectedTwiceMonthlyFields = document.getElementById("expectedTwiceMonthlyFields");
const expectedSecondDayOfMonth = document.getElementById("expectedSecondDayOfMonth");
const expectedKind = null;
const expectedAmount = document.getElementById("expectedAmount");
const expectedDesc = document.getElementById("expectedDesc");
const expectedNotes = document.getElementById("expectedNotes");
const expectedAccountId = document.getElementById("expectedAccountId");
const expectedCategoryId = document.getElementById("expectedCategoryId");
const addExpectedTxBtn = document.getElementById("addExpectedTxBtn");

// Expected transaction edit modal
const expectedEditModal = document.getElementById("expectedEditModal");
const expectedEditErr = document.getElementById("expectedEditErr");
const expectedEditId = document.getElementById("expectedEditId");
const expectedEditStartDate = document.getElementById("expectedEditStartDate");
const expectedEditRecurrence = document.getElementById("expectedEditRecurrence");
const expectedEditLastTxnDate = document.getElementById("expectedEditLastTxnDate");
const expectedEditTwiceMonthlyFields = document.getElementById("expectedEditTwiceMonthlyFields");
const expectedEditSecondDayOfMonth = document.getElementById("expectedEditSecondDayOfMonth");
const expectedEditAmount = document.getElementById("expectedEditAmount");
const expectedEditDesc = document.getElementById("expectedEditDesc");
const expectedEditNotes = document.getElementById("expectedEditNotes");
const expectedEditAccountId = document.getElementById("expectedEditAccountId");
const expectedEditCategoryId = document.getElementById("expectedEditCategoryId");
const expectedEditSave = document.getElementById("expectedEditSave");
const expectedEditDelete = document.getElementById("expectedEditDelete");
const expectedEditCancel = document.getElementById("expectedEditCancel");

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

// Expected instance editing
const instanceDate = document.getElementById("instanceDate");
const instanceExpectedTxId = document.getElementById("instanceExpectedTxId");
const instanceKind = null;
const instanceAmount = document.getElementById("instanceAmount");
const instanceDesc = document.getElementById("instanceDesc");
const instanceNotes = document.getElementById("instanceNotes");
const instanceAccountId = document.getElementById("instanceAccountId");
const instanceCategoryId = document.getElementById("instanceCategoryId");
const saveInstanceOverrideBtn = document.getElementById("saveInstanceOverrideBtn");
const cancelInstanceOverrideBtn = document.getElementById("cancelInstanceOverrideBtn");
const deleteFutureInstancesBtn = document.getElementById("deleteFutureInstancesBtn");
const expectedInstanceErr = document.getElementById("expectedInstanceErr");

if (instanceDate) {
  // Prefer the native calendar popout when supported (Chrome/Edge/Safari).
  instanceDate.addEventListener("click", () => {
    try {
      if (typeof instanceDate.showPicker === "function") instanceDate.showPicker();
    } catch (_) {}
  });

  // Allow moving a single occurrence to another date.
  instanceDate.addEventListener("change", () => {
    if (!selectedExpectedInstance) return;
    const iso = normalizeIsoDate(instanceDate.value);
    if (!iso) return;
    selectedExpectedMovedToDate = iso;
    show(expectedInstanceErr, "");
  });
}

const txEditModal = document.getElementById("txEditModal");
const txEditId = document.getElementById("txEditId");
const txEditDate = document.getElementById("txEditDate");
const txEditKind = null;
const txEditAmount = document.getElementById("txEditAmount");
const txEditDesc = document.getElementById("txEditDesc");
const txEditNotes = document.getElementById("txEditNotes");
const txEditCategoryId = document.getElementById("txEditCategoryId");
const txEditErr = document.getElementById("txEditErr");
const txEditSave = document.getElementById("txEditSave");
const txEditDelete = document.getElementById("txEditDelete");
const txEditCancel = document.getElementById("txEditCancel");

// Reconcile day modal
const reconcileModal = document.getElementById("reconcileModal");
const reconcileErr = document.getElementById("reconcileErr");
const reconcileDateText = document.getElementById("reconcileDateText");
const reconcileChecked = document.getElementById("reconcileChecked");
const reconcileSaveBtn = document.getElementById("reconcileSaveBtn");
const reconcileCancelBtn = document.getElementById("reconcileCancelBtn");
let reconcileActiveDate = "";

// One-time transaction add modal
const txAddModal = document.getElementById("txAddModal");
const txAddErr = document.getElementById("txAddErr");
const txAddDate = document.getElementById("txAddDate");
const txAddAmount = document.getElementById("txAddAmount");
const txAddDesc = document.getElementById("txAddDesc");
const txAddNotes = document.getElementById("txAddNotes");
const txAddCategoryId = document.getElementById("txAddCategoryId");
const txAddSave = document.getElementById("txAddSave");
const txAddCancel = document.getElementById("txAddCancel");

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
    if (!lowBalanceThreshold || !lowBalanceResult) return;
    if (!state.activeFamilyId) {
      setLowBalanceResult("", true);
      return;
    }

    const thresholdVal = toNum(lowBalanceThreshold.value);
    if (!Number.isFinite(thresholdVal)) {
      setLowBalanceResult('<div class="k">Low Balance Alert</div><div class="v">Enter a threshold to start.</div>', true);
      return;
    }

    if (lowBalanceLastQuery.familyId === state.activeFamilyId && lowBalanceLastQuery.threshold === thresholdVal) return;
    lowBalanceLastQuery = { familyId: state.activeFamilyId, threshold: thresholdVal };

    setLowBalanceResult('<div class="k">Low Balance Alert</div><div class="v">Checking…</div>', true);

    const startIso = toISODate(new Date());
    const days = 1825;
    const mode = calendarMode?.value || "both";
    const data = await api(
      `/api/families/${state.activeFamilyId}/low-balance-first?threshold=${encodeURIComponent(String(thresholdVal))}&start=${encodeURIComponent(
        startIso
      )}&days=${days}&mode=${encodeURIComponent(mode)}`,
      "GET"
    );
    const hit = data?.hit_date ? { date: data.hit_date, balance: toNum(data.hit_balance) } : null;

    if (!hit) {
      setLowBalanceResult(
        `<div class="k">First date ≤ $${fmtMoneyThreshold(lowBalanceThreshold.value, thresholdVal)}</div><div class="v">None in the next ${days} days.</div>`,
        true
      );
      return;
    }

    setLowBalanceResult(
      `<div class="k">First date ≤ $${fmtMoneyThreshold(lowBalanceThreshold.value, thresholdVal)}</div><div class="v danger">${fmtDateMDY(hit.date)} — $${fmtMoney(hit.balance)}</div>`,
      false
    );
  } catch (e) {
    show(lowBalanceErr, e.message || "Failed to compute low balance alert");
    setLowBalanceResult("", true);
  }
}

function scheduleLowBalanceRefresh() {
  if (!lowBalanceThreshold) return;
  try {
    localStorage.setItem(LOW_BALANCE_THRESHOLD_KEY, lowBalanceThreshold.value || "");
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

const calendarGoToday = document.getElementById("calendarGoToday");
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
  if (key === "lowBalance" && !userSet) {
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

if (calendarMode) {
  calendarMode.addEventListener("change", async () => {
    await loadCalendarMonthDaily();
    renderCalendar();
  });
}

familySelect.addEventListener("change", async () => {
  state.activeFamilyId = Number(familySelect.value);
  await loadCategories();
  await loadAccounts();
  await loadExpectedTransactions();
  await loadMonthAndCalendar();
});

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

document.getElementById("addTxBtn").addEventListener("click", async () => {
  try {
    show(addTxErr, "");
    const dateVal = document.getElementById("txDate").value;
    const desc = document.getElementById("txDesc").value.trim();
    const notesRaw = document.getElementById("txNotes")?.value?.trim() || "";
    const kind = getRadioValue("txKind", "expense");
    const amountVal = document.getElementById("txAmount").value;
    const categoryId = document.getElementById("txCategoryId").value || null;
    const reimbursable = !!document.getElementById("txReimbursable")?.checked;

    if (!dateVal) throw new Error("Date is required");
    if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");

    await api(`/api/families/${state.activeFamilyId}/transactions`, "POST", {
      date: dateVal,
      description: desc,
      notes: notesRaw || null,
      kind,
      amount: Number(amountVal),
      category_id: categoryId ? Number(categoryId) : null,
      reimbursable,
    });

    document.getElementById("txDesc").value = "";
    const txNotesEl = document.getElementById("txNotes");
    if (txNotesEl) txNotesEl.value = "";
    document.getElementById("txAmount").value = "";
    const reimbEl = document.getElementById("txReimbursable");
    if (reimbEl) reimbEl.checked = false;
    await loadMonthAndCalendar();
  } catch (e) {
    show(addTxErr, e.message || "Failed to add transaction");
  }
});

if (txAddSave) {
  txAddSave.addEventListener("click", async () => {
    try {
      show(txAddErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");

      const dateVal = txAddDate?.value || "";
      const desc = txAddDesc?.value?.trim() || "";
      const notesRaw = txAddNotes?.value?.trim() || "";
      const kind = getRadioValue("txAddKind", "expense");
      const amountVal = txAddAmount?.value || "";
      const categoryId = txAddCategoryId?.value || null;

      if (!dateVal) throw new Error("Date is required");
      if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");

      await api(`/api/families/${state.activeFamilyId}/transactions`, "POST", {
        date: dateVal,
        description: desc,
        notes: notesRaw || null,
        kind,
        amount: Number(amountVal),
        category_id: categoryId ? Number(categoryId) : null,
      });

      closeTxAddModal();
      await loadMonthAndCalendar();
    } catch (e) {
      show(txAddErr, e.message || "Failed to add transaction");
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
  if (!txEditCategoryId) return;
  txEditCategoryId.innerHTML = "";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "Uncategorized";
  txEditCategoryId.appendChild(emptyOpt);
  for (const c of state.categories || []) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    txEditCategoryId.appendChild(opt);
  }
}

function openTxEditModal(tx) {
  if (!txEditModal || !txEditId || !txEditDate) return;
  txEditId.value = String(tx.id);
  txEditDate.value = tx.date;
  {
    const k = tx && tx.kind ? String(tx.kind) : "expense";
    const radio = document.querySelector(`input[type="radio"][name="txEditKind"][value="${k}"]`);
    if (radio) radio.checked = true;
  }
  txEditAmount.value = tx.amount;
  txEditDesc.value = String(tx.description || "").slice(0, 12);
  if (txEditNotes) txEditNotes.value = tx.notes || "";
  renderTxEditCategoryOptions();
  txEditCategoryId.value = tx.category_id != null ? String(tx.category_id) : "";
  show(txEditErr, "");
  txEditModal.classList.add("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "false");
}

function closeTxEditModal() {
  if (!txEditModal) return;
  txEditModal.classList.remove("modal-overlay--open");
  txEditModal.setAttribute("aria-hidden", "true");
}

function openTxAddModal(opts = {}) {
  if (!txAddModal || !txAddDate) return;
  const dateVal = opts.date || "";
  txAddDate.value = dateVal;
  if (txAddAmount) txAddAmount.value = "";
  if (txAddDesc) txAddDesc.value = "";
  if (txAddNotes) txAddNotes.value = "";
  if (txAddCategoryId) txAddCategoryId.value = "";
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
        description: txEditDesc.value.trim() || "",
        notes: txEditNotes && txEditNotes.value.trim() ? txEditNotes.value.trim() : null,
        category_id: txEditCategoryId.value ? Number(txEditCategoryId.value) : null,
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
  if (e.key === "Escape" && txEditModal?.classList.contains("modal-overlay--open")) closeTxEditModal();
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

    // Click on an empty part of a day cell opens the one-time transaction popup.
    // (Expected tx lines stopPropagation in their own handler.)
    const cell = e.target.closest(".cal-cell");
    if (!cell || !calendarGrid.contains(cell)) return;
    const iso = cell.dataset.iso;
    if (!iso) return;
    openTxAddModal({ date: iso });
  });
}

addExpectedTxBtn.addEventListener("click", async () => {
  try {
    show(expectedTxErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    if (!state.accounts.length) throw new Error("Add an account first");

    const startDateVal = expectedStartDate.value;
    const recurrenceVal = expectedRecurrence.value;
    const kindVal = getRadioValue("expectedKind", "expense");
    const amountVal = expectedAmount.value;
    const desc = expectedDesc.value.trim();
    const notesVal = expectedNotes && expectedNotes.value.trim() ? expectedNotes.value.trim() : null;
    const accountIdVal = expectedAccountId.value;
    const categoryIdVal = expectedCategoryId.value || null;

    if (!startDateVal) throw new Error("Start date is required");
    if (!desc) throw new Error("Description is required");
    if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");
    if (!accountIdVal) throw new Error("Account is required");

    const lastTxnVal = expectedLastTxnDate && expectedLastTxnDate.value ? expectedLastTxnDate.value : null;
    if (lastTxnVal && lastTxnVal < startDateVal) {
      throw new Error("Last transaction date cannot be before start date");
    }

    let secondDayOfMonth = null;
    if (recurrenceVal === "twice_monthly") {
      const raw = expectedSecondDayOfMonth && expectedSecondDayOfMonth.value;
      const n = raw !== "" && raw != null ? Number(raw) : NaN;
      if (!Number.isFinite(n) || n < 1 || n > 31) {
        throw new Error("2nd day of month (1–31) is required for twice monthly");
      }
      const startDay = Number(startDateVal.slice(8, 10));
      if (n === startDay) {
        throw new Error("2nd day of month must differ from the start date’s day of month");
      }
      secondDayOfMonth = n;
    }

    await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "POST", {
      account_id: Number(accountIdVal),
      start_date: startDateVal,
      end_date: lastTxnVal,
      recurrence: recurrenceVal,
      second_day_of_month: secondDayOfMonth,
      description: desc,
      notes: notesVal,
      kind: kindVal,
      amount: Number(amountVal),
      category_id: categoryIdVal ? Number(categoryIdVal) : null,
    });

    expectedDesc.value = "";
    if (expectedNotes) expectedNotes.value = "";
    if (expectedLastTxnDate) expectedLastTxnDate.value = "";
    if (expectedSecondDayOfMonth) expectedSecondDayOfMonth.value = "";
    expectedAmount.value = "";
    await loadExpectedTransactions();
    await loadExpectedCalendar();
    await loadCalendarMonthDaily();
    renderCalendar();
  } catch (e) {
    show(expectedTxErr, e.message || "Failed to add recurring transaction");
  }
});

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

if (saveInstanceOverrideBtn) {
  saveInstanceOverrideBtn.addEventListener("click", async () => {
    try {
      show(expectedInstanceErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");

      const amountVal = instanceAmount.value;
      const amount = amountVal ? Number(amountVal) : null;
      if (!amount || Number.isNaN(amount) || amount <= 0) throw new Error("Amount must be > 0");

      const accountId = instanceAccountId.value;
      if (!accountId) throw new Error("Account is required");

      const categoryId = instanceCategoryId.value ? Number(instanceCategoryId.value) : null;

      const scopeEl = document.querySelector('input[name="instanceSaveScope"]:checked');
      const scope = scopeEl && scopeEl.value === "future" ? "future" : "this";
      const meta = getExpectedSeriesMeta(selectedExpectedInstance.expected_transaction_id);

      const occ = normalizeIsoDate(selectedExpectedInstance.occurrence_date);
      if (!occ) throw new Error("Invalid occurrence date");
      const movedTo = normalizeIsoDate(selectedExpectedMovedToDate || "") || null;

      if (scope === "future") {
        if (!meta || meta.recurrence === "once") {
          throw new Error('"This date and all future" applies only to recurring schedules (not "once").');
        }
        const applyPayload = {
          account_id: Number(accountId),
          kind: getRadioValue("instanceKind", "expense"),
          amount,
          description: instanceDesc.value.trim() || "",
          category_id: categoryId,
        };
        await api(
          `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/apply-from-occurrence/${occ}`,
          "POST",
          applyPayload
        );
      } else {
        const payload = {
          action: "update",
          account_id: Number(accountId),
          kind: getRadioValue("instanceKind", "expense"),
          amount,
          description: instanceDesc.value.trim() || "",
          category_id: categoryId,
          moved_to_date: movedTo,
        };
        await api(
          `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${occ}`,
          "POST",
          payload
        );
      }

      closeExpectedEditModal();
      await refreshExpectedCalendarAndMonth();
    } catch (e) {
      show(expectedInstanceErr, e.message || "Failed to save override");
    }
  });
}

if (cancelInstanceOverrideBtn) {
  cancelInstanceOverrideBtn.addEventListener("click", async () => {
    try {
      show(expectedInstanceErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");
      if (!confirm("Remove only this occurrence? It will no longer appear on the calendar.")) return;

      const cancelOcc = normalizeIsoDate(selectedExpectedInstance.occurrence_date) || selectedExpectedInstance.occurrence_date;
      await api(
        `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${cancelOcc}`,
        "POST",
        { action: "cancel" }
      );

      closeExpectedEditModal();
      await refreshExpectedCalendarAndMonth();
    } catch (e) {
      show(expectedInstanceErr, e.message || "Failed to cancel occurrence");
    }
  });
}

if (deleteFutureInstancesBtn) {
  deleteFutureInstancesBtn.addEventListener("click", async () => {
    try {
      show(expectedInstanceErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");

      const meta = getExpectedSeriesMeta(selectedExpectedInstance.expected_transaction_id);
      if (!meta || meta.recurrence === "once") {
        throw new Error("This series is not recurring.");
      }

      const occ = normalizeIsoDate(selectedExpectedInstance.occurrence_date);
      if (!occ) throw new Error("Invalid occurrence date");

      if (!confirm("Remove this date and all later occurrences? Past dates stay on the schedule.")) return;

      await api(
        `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/end-from-occurrence/${occ}`,
        "POST"
      );

      closeExpectedEditModal();
      await refreshExpectedCalendarAndMonth();
    } catch (e) {
      show(expectedInstanceErr, e.message || "Failed to delete future occurrences");
    }
  });
}

const expectedInstanceDeleteSeriesBtn = document.getElementById("expectedInstanceDeleteSeriesBtn");
if (expectedInstanceDeleteSeriesBtn) {
  expectedInstanceDeleteSeriesBtn.addEventListener("click", () => {
    const id = expectedEditId?.value || (selectedExpectedInstance ? String(selectedExpectedInstance.expected_transaction_id) : null);
    const occ = selectedExpectedInstance ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) : null;
    openExpectedDeleteModal(id, occ);
  });
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

function renderCategoryOptions(selectEl, categories) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "Uncategorized";
  selectEl.appendChild(emptyOpt);

  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.textContent = c.name;
    selectEl.appendChild(opt);
  }
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
  renderCategoryOptions(txCategoryId, state.categories);
  renderCategoryOptions(txAddCategoryId, state.categories);
  renderCategoryOptions(expectedCategoryId, state.categories);
  renderCategoryOptions(expectedEditCategoryId, state.categories);
  if (instanceCategoryId) renderCategoryOptions(instanceCategoryId, state.categories);
  renderTxEditCategoryOptions();
}

function categoryStyleFromId(categoryId) {
  if (!categoryId) return null;
  const c = (state.categories || []).find((x) => Number(x.id) === Number(categoryId));
  if (!c) return null;
  const fg = c.fg_color && String(c.fg_color).trim() ? String(c.fg_color).trim() : null;
  const bg = c.bg_color && String(c.bg_color).trim() ? String(c.bg_color).trim() : null;
  return { name: c.name, fg, bg };
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
  renderAccountSelect(expectedAccountId, state.accounts);
  if (expectedEditAccountId) renderAccountSelect(expectedEditAccountId, state.accounts);
  if (instanceAccountId) renderAccountSelect(instanceAccountId, state.accounts);
  if (state.accounts.length > 0 && !expectedAccountId.value) {
    expectedAccountId.value = String(state.accounts[0].id);
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

function updateExpectedTwiceMonthlyVisibility() {
  if (!expectedTwiceMonthlyFields || !expectedRecurrence) return;
  const on = expectedRecurrence.value === "twice_monthly";
  expectedTwiceMonthlyFields.style.display = on ? "block" : "none";
}

if (expectedRecurrence) {
  expectedRecurrence.addEventListener("change", updateExpectedTwiceMonthlyVisibility);
}

function updateExpectedEditTwiceMonthlyVisibility() {
  if (!expectedEditTwiceMonthlyFields || !expectedEditRecurrence) return;
  const on = expectedEditRecurrence.value === "twice_monthly";
  expectedEditTwiceMonthlyFields.style.display = on ? "block" : "none";
}
if (expectedEditRecurrence) {
  expectedEditRecurrence.addEventListener("change", updateExpectedEditTwiceMonthlyVisibility);
}

function setExpectedModalMode(mode) {
  const instPanel = document.getElementById("expectedEditInstancePanel");
  const serPanel = document.getElementById("expectedEditSeriesPanel");
  const isInstance = mode === "instance";
  if (instPanel) instPanel.style.display = isInstance ? "block" : "none";
  if (serPanel) serPanel.style.display = isInstance ? "none" : "block";
}

async function refreshExpectedCalendarAndMonth() {
  await loadExpectedTransactions();
  await loadExpectedCalendar();
  await loadCalendarMonthDaily();
  renderCalendar();
}

function openExpectedEditModal(tx, opts = {}) {
  if (!expectedEditModal || !expectedEditId) return;
  const calendarItem = opts.calendarItem ?? null;
  const modeRow = document.getElementById("expectedModalModeRow");

  expectedEditId.value = String(tx.id);
  if (expectedEditStartDate) expectedEditStartDate.value = tx.start_date || "";
  if (expectedEditLastTxnDate) expectedEditLastTxnDate.value = tx.end_date || "";
  if (expectedEditRecurrence) expectedEditRecurrence.value = tx.recurrence || "monthly";
  if (expectedEditSecondDayOfMonth) expectedEditSecondDayOfMonth.value = tx.second_day_of_month != null ? String(tx.second_day_of_month) : "";

  const k = tx && tx.kind ? String(tx.kind) : "expense";
  const kRadio = document.querySelector(`input[type="radio"][name="expectedEditKind"][value="${k}"]`);
  if (kRadio) kRadio.checked = true;

  if (expectedEditAmount) expectedEditAmount.value = String(tx.amount ?? "");
  if (expectedEditDesc) expectedEditDesc.value = String(tx.description || "").slice(0, 12);
  if (expectedEditNotes) expectedEditNotes.value = tx.notes || "";
  if (expectedEditAccountId) expectedEditAccountId.value = tx.account_id != null ? String(tx.account_id) : "";
  if (expectedEditCategoryId) expectedEditCategoryId.value = tx.category_id != null ? String(tx.category_id) : "";

  updateExpectedEditTwiceMonthlyVisibility();

  if (calendarItem) {
    if (modeRow) modeRow.style.display = "flex";
    const rInst = document.getElementById("expectedModalModeInstance");
    if (rInst) rInst.checked = true;
    selectExpectedInstance(calendarItem);
    setExpectedModalMode("instance");
  } else {
    if (modeRow) modeRow.style.display = "none";
    selectedExpectedInstance = null;
    const rSer = document.getElementById("expectedModalModeSeries");
    if (rSer) rSer.checked = true;
    setExpectedModalMode("series");
  }

  updateInstanceScopeUI();
  show(expectedEditErr, "");
  show(expectedInstanceErr, "");
  expectedEditModal.classList.add("modal-overlay--open");
  expectedEditModal.setAttribute("aria-hidden", "false");
}

function closeExpectedEditModal() {
  if (!expectedEditModal) return;
  expectedEditModal.classList.remove("modal-overlay--open");
  expectedEditModal.setAttribute("aria-hidden", "true");
  selectedExpectedInstance = null;
  selectedExpectedMovedToDate = null;
  if (instanceDate) instanceDate.value = "";
  if (instanceExpectedTxId) instanceExpectedTxId.value = "";
  if (instanceNotes) instanceNotes.value = "";
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

document.querySelectorAll('input[name="expectedModalMode"]').forEach((el) => {
  el.addEventListener("change", () => {
    const v = document.querySelector('input[name="expectedModalMode"]:checked')?.value;
    if (v === "instance" || v === "series") setExpectedModalMode(v);
  });
});

if (expectedEditCancel) {
  expectedEditCancel.addEventListener("click", () => closeExpectedEditModal());
}
if (expectedEditModal) {
  expectedEditModal.addEventListener("click", (e) => {
    if (e.target === expectedEditModal) closeExpectedEditModal();
  });
}

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
    closeExpectedEditModal();
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

if (expectedEditSave) {
  expectedEditSave.addEventListener("click", async () => {
    try {
      show(expectedEditErr, "");
      if (!state.activeFamilyId) throw new Error("Choose a family first");
      const id = expectedEditId.value;
      if (!id) throw new Error("No recurring transaction selected");

      const start = expectedEditStartDate?.value || "";
      if (!start) throw new Error("Start date is required");

      const recurrence = expectedEditRecurrence?.value || "monthly";
      const endDate = expectedEditLastTxnDate?.value || null;
      if (endDate && endDate < start) throw new Error("Last transaction date cannot be before start date");

      let secondDayOfMonth = null;
      if (recurrence === "twice_monthly") {
        const raw = expectedEditSecondDayOfMonth?.value;
        const n = raw !== "" && raw != null ? Number(raw) : NaN;
        if (!Number.isFinite(n) || n < 1 || n > 31) throw new Error("2nd day of month (1–31) is required for twice monthly");
        const startDay = Number(start.slice(8, 10));
        if (n === startDay) throw new Error("2nd day of month must differ from the start date’s day of month");
        secondDayOfMonth = n;
      }

      const amountVal = expectedEditAmount?.value;
      if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");

      const accountIdVal = expectedEditAccountId?.value;
      if (!accountIdVal) throw new Error("Account is required");

      const categoryIdVal = expectedEditCategoryId?.value || null;

      await api(`/api/families/${state.activeFamilyId}/expected-transactions/${id}`, "PUT", {
        account_id: Number(accountIdVal),
        start_date: start,
        end_date: endDate,
        recurrence,
        second_day_of_month: secondDayOfMonth,
        description: expectedEditDesc?.value?.trim() || "",
        notes: expectedEditNotes && expectedEditNotes.value.trim() ? expectedEditNotes.value.trim() : null,
        kind: getRadioValue("expectedEditKind", "expense"),
        amount: Number(amountVal),
        category_id: categoryIdVal ? Number(categoryIdVal) : null,
      });

      closeExpectedEditModal();
      await refreshExpectedCalendarAndMonth();
    } catch (e) {
      show(expectedEditErr, e.message || "Failed to save");
    }
  });
}

if (expectedEditDelete) {
  expectedEditDelete.addEventListener("click", () => {
    const id = expectedEditId?.value || null;
    const occ = selectedExpectedInstance ? normalizeIsoDate(selectedExpectedInstance.occurrence_date) : null;
    openExpectedDeleteModal(id, occ);
  });
}

function renderExpectedTransactions(items) {
  expectedTxList.innerHTML = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No recurring transactions yet.";
    expectedTxList.appendChild(empty);
    return;
  }

  for (const tx of items) {
    const el = document.createElement("div");
    el.className = "item expected-item--dense";

    const amtClass = tx.kind === "income" ? "income" : "expense";
    const kindSign = tx.kind === "income" ? "+" : "-";
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
    descEl.className = `desc ${kindFgClass(tx.kind)}`;
    descEl.textContent = tx.description || "(no description)";

    const metaEl = document.createElement("div");
    metaEl.className = "meta";
      const bits = [
        `${fmtDateMDY(tx.start_date)}`,
        tx.end_date ? `ends ${fmtDateMDY(tx.end_date)}` : "",
      twiceMeta,
      tx.recurrence ? `recurs: ${tx.recurrence}` : "",
    ].filter(Boolean);
    metaEl.appendChild(document.createTextNode(bits.join(" ")));
    if (tx.category_id && tx.category) {
      const st = categoryStyleFromId(tx.category_id);
      const pill = document.createElement("span");
      pill.className = `cat-pill ${kindFgClass(tx.kind)}`;
      pill.textContent = tx.category;
      if (st?.fg) pill.style.color = st.fg;
      if (st?.bg) pill.style.background = st.bg;
      metaEl.appendChild(document.createTextNode(" · "));
      metaEl.appendChild(pill);
    } else if (tx.category) {
      metaEl.appendChild(document.createTextNode(` · ${tx.category}`));
    }

    left.appendChild(descEl);
    left.appendChild(metaEl);

    const amtBtn = document.createElement("button");
    amtBtn.type = "button";
    amtBtn.className = `amt ${amtClass} expected-amt-link`;
    amtBtn.textContent = `${kindSign}$${fmtMoney(tx.amount)}`;
    amtBtn.title = "Edit recurring transaction";
    amtBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExpectedEditModal(tx);
    });

    el.appendChild(left);
    el.appendChild(amtBtn);
    expectedTxList.appendChild(el);
  }
}

async function loadExpectedTransactions() {
  if (!state.activeFamilyId) return;
  const items = await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "GET");
  state.expectedTransactions = items || [];
  renderExpectedTransactions(state.expectedTransactions);
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

function renderTransactions(items) {
  txList.innerHTML = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pill";
    empty.textContent = "No transactions for this month.";
    txList.appendChild(empty);
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
      const st = categoryStyleFromId(tx.category_id);
      const pill = document.createElement("span");
      pill.className = `cat-pill ${kindFgClass(tx.kind)}`;
      pill.textContent = tx.category;
      if (st?.fg) pill.style.color = st.fg;
      if (st?.bg) pill.style.background = st.bg;
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
    txList.appendChild(el);
  }
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
    renderTotals(data?.totals || {});
    const items = data?.items || [];
    state.monthActualItems = items;
    renderTransactions(items);
  } catch (e) {
    show(txErr, e.message || "Failed to load transactions");
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
      return;
    }
  } catch (_) {
    /* offline or old API — fall back */
  }
  computeMonthDailyBalancesLegacy();
}

async function loadMonthAndCalendar() {
  if (!state.activeFamilyId) return;
  await loadTransactions();
  await loadExpectedCalendar();
  await loadCalendarExtras();
  await loadReconciledDays(calendarMonth?.value || monthInput.value);
  await loadCalendarMonthDaily();
  renderCalendar();
  await refreshLowBalanceAlert();
}

/** Client-only fallback when calendar-month-daily API is unavailable (approximate). */
function computeMonthDailyBalancesLegacy() {
  state.monthDailyBalances = new Map();
  const month = calendarMonth?.value || monthInput.value;
  if (!month) return;
  const [yearPart, monthPart] = String(month).split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthStartIso = dateISOFromParts(year, monthIndex, 1);

  const mode = calendarMode?.value || "both";
  const includeActual = mode === "both" || mode === "actual";
  const includeExpected = mode === "both" || mode === "expected";

  const dailyTxnTotals = new Map();
  const startAdds = new Map();
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = dateISOFromParts(year, monthIndex, d);
    dailyTxnTotals.set(iso, 0);
    startAdds.set(iso, 0);
  }

  if (includeActual) {
    for (const tx of state.monthActualItems || []) {
      const amt = Number(tx.amount || 0);
      const signed = tx.kind === "income" ? amt : -amt;
      const dk = normalizeIsoDate(tx.date) || tx.date;
      dailyTxnTotals.set(dk, (dailyTxnTotals.get(dk) || 0) + signed);
    }
  }
  if (includeExpected) {
    for (const tx of state.monthExpectedItems || []) {
      const amt = Number(tx.amount || 0);
      const signed = tx.kind === "income" ? amt : -amt;
      const dk = normalizeIsoDate(tx.date) || tx.date;
      dailyTxnTotals.set(dk, (dailyTxnTotals.get(dk) || 0) + signed);
    }
  }

  let carry = 0;
  for (const account of state.accounts || []) {
    const startBal = Number(account.starting_balance || 0);
    const startDate = normalizeIsoDate(account.starting_balance_date) || account.starting_balance_date || monthStartIso;
    if (startDate < monthStartIso) {
      carry += startBal;
    } else if (startAdds.has(startDate)) {
      startAdds.set(startDate, (startAdds.get(startDate) || 0) + startBal);
    }
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = dateISOFromParts(year, monthIndex, d);
    const dayStart = carry + (startAdds.get(iso) || 0);
    const txNet = dailyTxnTotals.get(iso) || 0;
    const dayEnd = dayStart + txNet;
    state.monthDailyBalances.set(iso, { start: dayStart, txNet, end: dayEnd });
    carry = dayEnd;
  }
}

function truncate(s, maxLen) {
  const str = String(s ?? "");
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function getExpectedSeriesMeta(expectedId) {
  return (state.expectedTransactions || []).find((t) => Number(t.id) === Number(expectedId));
}

function updateInstanceScopeUI() {
  const future = document.getElementById("instanceScopeFuture");
  const futureLabel = document.getElementById("instanceScopeFutureLabel");
  const cancelOccBtn = document.getElementById("cancelInstanceOverrideBtn");
  const delSeriesFromInst = document.getElementById("expectedInstanceDeleteSeriesBtn");
  if (!future) return;
  if (!selectedExpectedInstance) {
    future.disabled = true;
    if (futureLabel) futureLabel.style.opacity = "0.5";
    if (deleteFutureInstancesBtn) deleteFutureInstancesBtn.disabled = true;
    if (cancelOccBtn) cancelOccBtn.disabled = true;
    if (delSeriesFromInst) delSeriesFromInst.disabled = true;
    return;
  }
  if (cancelOccBtn) cancelOccBtn.disabled = false;
  if (delSeriesFromInst) delSeriesFromInst.disabled = false;
  const meta = getExpectedSeriesMeta(selectedExpectedInstance.expected_transaction_id);
  const allowFuture = !!(meta && meta.recurrence !== "once");
  future.disabled = !allowFuture;
  if (futureLabel) futureLabel.style.opacity = allowFuture ? "" : "0.5";
  if (deleteFutureInstancesBtn) deleteFutureInstancesBtn.disabled = !allowFuture;
  if (!allowFuture && future.checked) {
    const thisRadio = document.getElementById("instanceScopeThis");
    if (thisRadio) thisRadio.checked = true;
  }
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
  };

  if (instanceDate) {
    instanceDate.readOnly = false;
    instanceDate.disabled = false;
    selectedExpectedMovedToDate = normalizeIsoDate(item.date) || item.date;
    instanceDate.value = selectedExpectedMovedToDate;
  }
  if (instanceExpectedTxId) instanceExpectedTxId.value = String(item.expected_transaction_id);
  {
    const k = item && item.kind ? String(item.kind) : "expense";
    const radio = document.querySelector(`input[type="radio"][name="instanceKind"][value="${k}"]`);
    if (radio) radio.checked = true;
  }
  if (instanceAmount) instanceAmount.value = Number(item.amount);
  if (instanceDesc) instanceDesc.value = String(item.description || "").slice(0, 12);
  if (instanceNotes) instanceNotes.value = item.notes && String(item.notes).trim() ? String(item.notes).trim() : "";
  if (instanceAccountId) instanceAccountId.value = String(item.account_id);
  if (instanceCategoryId) instanceCategoryId.value = item.category_id ? String(item.category_id) : "";

  show(expectedInstanceErr, "");
  updateInstanceScopeUI();
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
    const isReconciled = state.reconciledDates && state.reconciledDates.has(iso);
    cell.innerHTML = `
      <div class="cal-daynum"><span>${dObj.getDate()}</span>${isReconciled ? `
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
      if (!isExpected) line.dataset.txId = String(row.id);

      const labelRaw = isExpected ? row.description || "(expected)" : (row.description || "Transaction").trim();
      const label = truncate(labelRaw, 44);

      const labelSpan = document.createElement("span");
      labelSpan.className = `cal-tx-label ${kindFgClass(row.kind)}`;
      labelSpan.textContent = `${label} `;
      if (row.category_id && row.category) {
        const st = categoryStyleFromId(row.category_id);
        if (st?.fg) labelSpan.style.color = st.fg;
        if (st?.bg) labelSpan.style.background = st.bg;
        if (st?.bg) {
          labelSpan.style.padding = "1px 6px";
          labelSpan.style.borderRadius = "6px";
          labelSpan.style.border = "1px solid var(--border)";
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
        const bits = [String(labelRaw || "").trim() || (isExpected ? "Expected" : "Transaction")];
        if (row.notes && String(row.notes).trim()) bits.push(String(row.notes).trim());
        if (isExpected) bits[0] = `Expected: ${bits[0]}`;
        line.title = bits.join("\n");
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

    const dayBal = isOutOfMonth ? null : state.monthDailyBalances.get(iso);

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

function setDefaultExpectedStartDate() {
  expectedStartDate.value = toISODate(new Date());
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
  setDefaultExpectedStartDate();
  setDefaultAccountStartDate();
  await loadMe();
  await loadFamilies();
  if (state.activeFamilyId) {
    await loadCategories();
    await loadAccounts();
    await loadExpectedTransactions();
    await loadMonthAndCalendar();
  }
  if (lowBalanceThreshold) {
    let stored = "";
    try {
      stored = localStorage.getItem(LOW_BALANCE_THRESHOLD_KEY) || "";
    } catch (_) {}
    if (stored && !lowBalanceThreshold.value) lowBalanceThreshold.value = stored;
    lowBalanceThreshold.addEventListener("input", scheduleLowBalanceRefresh);
    lowBalanceThreshold.addEventListener("change", scheduleLowBalanceRefresh);
    await refreshLowBalanceAlert();
  }
  updateExpectedTwiceMonthlyVisibility();
}

main().catch((e) => {
  if (userPill) userPill.textContent = "Not connected";
  const m = e.message || "Failed to load app";
  show(familiesErr, m);
  show(txErr, m);
});

