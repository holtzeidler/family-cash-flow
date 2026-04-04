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

let state = {
  user: null,
  families: [],
  activeFamilyId: null,
  categories: [],
  accounts: [],
  expectedTransactions: [],
  monthActualItems: [],
  monthExpectedItems: [],
  monthDailyBalances: new Map(),
};

let selectedExpectedInstance = null;

const userPill = document.getElementById("userPill");
const familiesErr = document.getElementById("familiesErr");
const txErr = document.getElementById("txErr");
const catErr = document.getElementById("catErr");
const addTxErr = document.getElementById("addTxErr");

const familySelect = document.getElementById("familySelect");
const monthInput = document.getElementById("monthInput");
const totalsEl = document.getElementById("totals");
const txList = document.getElementById("txList");

const categorySelect = document.getElementById("categorySelect");
const txCategoryId = document.getElementById("txCategoryId");

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
const expectedRecurrence = document.getElementById("expectedRecurrence");
const expectedKind = document.getElementById("expectedKind");
const expectedAmount = document.getElementById("expectedAmount");
const expectedDesc = document.getElementById("expectedDesc");
const expectedAccountId = document.getElementById("expectedAccountId");
const expectedCategoryId = document.getElementById("expectedCategoryId");
const addExpectedTxBtn = document.getElementById("addExpectedTxBtn");

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

// Chart
const chartStart = document.getElementById("chartStart");
const chartDaysRange = document.getElementById("chartDaysRange");
const chartDaysLabel = document.getElementById("chartDaysLabel");
const runProjectionChartBtn = document.getElementById("runProjectionChartBtn");
const chartErr = document.getElementById("chartErr");
const projectionChartCanvas = document.getElementById("projectionChartCanvas");

// Expected instance editing
const instanceDate = document.getElementById("instanceDate");
const instanceExpectedTxId = document.getElementById("instanceExpectedTxId");
const instanceKind = document.getElementById("instanceKind");
const instanceAmount = document.getElementById("instanceAmount");
const instanceDesc = document.getElementById("instanceDesc");
const instanceAccountId = document.getElementById("instanceAccountId");
const instanceCategoryId = document.getElementById("instanceCategoryId");
const saveInstanceOverrideBtn = document.getElementById("saveInstanceOverrideBtn");
const cancelInstanceOverrideBtn = document.getElementById("cancelInstanceOverrideBtn");
const expectedInstanceErr = document.getElementById("expectedInstanceErr");

const txEditModal = document.getElementById("txEditModal");
const txEditId = document.getElementById("txEditId");
const txEditDate = document.getElementById("txEditDate");
const txEditKind = document.getElementById("txEditKind");
const txEditAmount = document.getElementById("txEditAmount");
const txEditDesc = document.getElementById("txEditDesc");
const txEditCategoryId = document.getElementById("txEditCategoryId");
const txEditErr = document.getElementById("txEditErr");
const txEditSave = document.getElementById("txEditSave");
const txEditDelete = document.getElementById("txEditDelete");
const txEditCancel = document.getElementById("txEditCancel");

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", "POST");
  window.location.href = "./login.html";
});

function initCalendarYearOptions() {
  if (!calendarYear || calendarYear.dataset.populated === "1") return;
  calendarYear.dataset.populated = "1";
  const y0 = new Date().getFullYear();
  for (let y = y0 - 35; y <= y0 + 25; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    calendarYear.appendChild(opt);
  }
}

function ensureCalendarYearOption(y) {
  if (!calendarYear) return;
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

const CALENDAR_COLLAPSED_KEY = "familyCashFlow_calendarCollapsed";

function applyCalendarCollapsed(collapsed) {
  const panel = document.getElementById("calendarPanel");
  const btn = document.getElementById("calendarCollapseBtn");
  if (!panel || !btn) return;
  panel.classList.toggle("calendar-panel--collapsed", collapsed);
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  btn.title = collapsed ? "Expand calendar" : "Collapse calendar";
  try {
    localStorage.setItem(CALENDAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}

const calendarCollapseBtn = document.getElementById("calendarCollapseBtn");
if (calendarCollapseBtn) {
  calendarCollapseBtn.addEventListener("click", () => {
    const panel = document.getElementById("calendarPanel");
    if (!panel) return;
    applyCalendarCollapsed(!panel.classList.contains("calendar-panel--collapsed"));
  });
  try {
    if (localStorage.getItem(CALENDAR_COLLAPSED_KEY) === "1") applyCalendarCollapsed(true);
  } catch (_) {}
}

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
    const kind = document.getElementById("txKind").value;
    const amountVal = document.getElementById("txAmount").value;
    const categoryId = document.getElementById("txCategoryId").value || null;

    if (!dateVal) throw new Error("Date is required");
    if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");

    await api(`/api/families/${state.activeFamilyId}/transactions`, "POST", {
      date: dateVal,
      description: desc,
      kind,
      amount: Number(amountVal),
      category_id: categoryId ? Number(categoryId) : null,
    });

    document.getElementById("txDesc").value = "";
    document.getElementById("txAmount").value = "";
    await loadMonthAndCalendar();
  } catch (e) {
    show(addTxErr, e.message || "Failed to add transaction");
  }
});

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
  txEditKind.value = tx.kind;
  txEditAmount.value = tx.amount;
  txEditDesc.value = tx.description || "";
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
        kind: txEditKind.value,
        amount: Number(amountVal),
        description: txEditDesc.value.trim() || "",
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

if (calendarGrid) {
  calendarGrid.addEventListener("click", (e) => {
    const part = e.target.closest(".cal-tx-part");
    if (!part || !calendarGrid.contains(part)) return;
    const id = Number(part.dataset.txId);
    if (!id) return;
    const tx = (state.monthActualItems || []).find((t) => Number(t.id) === id);
    if (tx) openTxEditModal(tx);
  });
}

addExpectedTxBtn.addEventListener("click", async () => {
  try {
    show(expectedTxErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    if (!state.accounts.length) throw new Error("Add an account first");

    const startDateVal = expectedStartDate.value;
    const recurrenceVal = expectedRecurrence.value;
    const kindVal = expectedKind.value;
    const amountVal = expectedAmount.value;
    const desc = expectedDesc.value.trim();
    const accountIdVal = expectedAccountId.value;
    const categoryIdVal = expectedCategoryId.value || null;

    if (!startDateVal) throw new Error("Start date is required");
    if (!desc) throw new Error("Description is required");
    if (!amountVal || Number(amountVal) <= 0) throw new Error("Amount must be > 0");
    if (!accountIdVal) throw new Error("Account is required");

    await api(`/api/families/${state.activeFamilyId}/expected-transactions`, "POST", {
      account_id: Number(accountIdVal),
      start_date: startDateVal,
      recurrence: recurrenceVal,
      description: desc,
      kind: kindVal,
      amount: Number(amountVal),
      category_id: categoryIdVal ? Number(categoryIdVal) : null,
    });

    expectedDesc.value = "";
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
  });
}

runProjectionChartBtn.addEventListener("click", async () => {
  try {
    show(chartErr, "");
    projectionChartCanvas.dataset.status = "";
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    if (!chartStart?.value) throw new Error("Chart start date is required");

    const startVal = chartStart.value;
    const daysVal = Number(chartDaysRange.value);

    const summary = await api(
      `/api/families/${state.activeFamilyId}/projection?start=${encodeURIComponent(startVal)}&days=${daysVal}&include_accounts=false`,
      "GET"
    );

    drawProjectionChart(summary?.daily || []);
  } catch (e) {
    show(chartErr, e.message || "Failed to update chart");
  }
});

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

    const payload = {
      action: "update",
      account_id: Number(accountId),
      kind: instanceKind.value,
      amount,
      description: instanceDesc.value.trim() || "",
      category_id: categoryId,
    };

    await api(
      `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${selectedExpectedInstance.occurrence_date}`,
      "POST",
      payload
    );

    await loadExpectedCalendar();
    await loadCalendarMonthDaily();
    renderCalendar();
  } catch (e) {
    show(expectedInstanceErr, e.message || "Failed to save override");
  }
});

cancelInstanceOverrideBtn.addEventListener("click", async () => {
  try {
    show(expectedInstanceErr, "");
    if (!state.activeFamilyId) throw new Error("Choose a family first");
    if (!selectedExpectedInstance) throw new Error("Select an expected occurrence from the calendar");

    await api(
      `/api/families/${state.activeFamilyId}/expected-transactions/${selectedExpectedInstance.expected_transaction_id}/instances/${selectedExpectedInstance.occurrence_date}`,
      "POST",
      { action: "cancel" }
    );

    selectedExpectedInstance = null;
    if (instanceDate) instanceDate.value = "";
    if (instanceExpectedTxId) instanceExpectedTxId.value = "";
    await loadExpectedCalendar();
    await loadCalendarMonthDaily();
    renderCalendar();
  } catch (e) {
    show(expectedInstanceErr, e.message || "Failed to cancel occurrence");
  }
});

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

async function loadCategories() {
  if (!state.activeFamilyId) return;
  const categories = await api(`/api/families/${state.activeFamilyId}/categories`, "GET");
  state.categories = categories || [];
  renderCategoryOptions(categorySelect, state.categories);
  renderCategoryOptions(txCategoryId, state.categories);
  renderCategoryOptions(expectedCategoryId, state.categories);
  if (instanceCategoryId) renderCategoryOptions(instanceCategoryId, state.categories);
  renderTxEditCategoryOptions();
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
        <div class="meta">${typeLabel} · Starting: $${fmtMoney(a.starting_balance)} on ${escapeHtml(startDate)}</div>
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
    el.className = "item";

    const amtClass = tx.kind === "income" ? "income" : "expense";
    const kindSign = tx.kind === "income" ? "+" : "-";
    const metaBits = [
      `${tx.start_date}`,
      tx.recurrence ? `recurs: ${tx.recurrence}` : "",
      tx.account ? `· ${tx.account}` : "",
      tx.category ? `· ${tx.category}` : "",
    ].filter(Boolean);

    el.innerHTML = `
      <div class="left">
        <div class="desc">${escapeHtml(tx.description || "(no description)")}</div>
        <div class="meta">${metaBits.join(" ")}</div>
      </div>
      <div class="amt ${amtClass}">${kindSign}$${fmtMoney(tx.amount)}</div>
    `;
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
        <div class="desc">${d.date}</div>
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

    const amtClass = tx.kind === "income" ? "income" : "expense";
    const category = tx.category ? ` · ${tx.category}` : "";

    el.innerHTML = `
      <div class="left">
        <div class="desc">${escapeHtml(tx.description || "(no description)")}</div>
        <div class="meta">${tx.date}${category}</div>
      </div>
      <div class="amt ${amtClass}">${tx.kind === "income" ? "+" : "-"}$${fmtMoney(tx.amount)}</div>
    `;
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

/** Normalize API/legacy dates to YYYY-MM-DD for Map keys. */
function normalizeIsoDate(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
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
  await loadCalendarMonthDaily();
  renderCalendar();
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

function dateISOFromParts(year, monthIndex0Based, day) {
  const y = year;
  const m = String(monthIndex0Based + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function selectExpectedInstance(item) {
  selectedExpectedInstance = {
    expected_transaction_id: item.expected_transaction_id,
    occurrence_date: item.date,
  };

  if (instanceDate) instanceDate.value = item.date;
  if (instanceExpectedTxId) instanceExpectedTxId.value = String(item.expected_transaction_id);
  if (instanceKind) instanceKind.value = item.kind;
  if (instanceAmount) instanceAmount.value = Number(item.amount);
  if (instanceDesc) instanceDesc.value = item.description || "";
  if (instanceAccountId) instanceAccountId.value = String(item.account_id);
  if (instanceCategoryId) instanceCategoryId.value = item.category_id ? String(item.category_id) : "";

  show(expectedInstanceErr, "");
}

function renderCalendar() {
  if (!calendarGrid) return;
  calendarGrid.innerHTML = "";

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
  for (const tx of state.monthActualItems || []) {
    if (!actualTxsByDate.has(tx.date)) actualTxsByDate.set(tx.date, []);
    actualTxsByDate.get(tx.date).push(tx);
  }
  for (const arr of actualTxsByDate.values()) {
    arr.sort((a, b) => Number(a.id) - Number(b.id));
  }

  const expectedByDate = new Map(); // iso -> [items]
  for (const item of state.monthExpectedItems || []) {
    const key = item.date;
    if (!expectedByDate.has(key)) expectedByDate.set(key, []);
    expectedByDate.get(key).push(item);
  }

  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const wrapper = document.createElement("div");
  wrapper.className = "calendar";

  for (const label of dow) {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = label;
    wrapper.appendChild(el);
  }

  const totalCells = 42; // 6 weeks
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell";

    const dayNum = i - offset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.style.opacity = "0.45";
      cell.innerHTML = `<div class="cal-daynum">&nbsp;</div>`;
      wrapper.appendChild(cell);
      continue;
    }

    const iso = dateISOFromParts(year, monthIndex, dayNum);
    cell.innerHTML = `
      <div class="cal-daynum">${dayNum}</div>
      <div class="cal-cell-fill"></div>
      <div class="cal-cell-stack">
        <div class="cal-day-txns"></div>
        <div class="cal-ledger-metrics"></div>
      </div>
    `;
    const txnsEl = cell.querySelector(".cal-day-txns");
    const metricsEl = cell.querySelector(".cal-ledger-metrics");

    const actualTxs = showActual ? actualTxsByDate.get(iso) || [] : [];
    const expectedItems = expectedByDate.get(iso) || [];

    if (showExpected) {
      for (const item of expectedItems) {
        const line = document.createElement("div");
        line.className = `cal-day-tx-line cal-day-tx-line--expected ${item.kind === "income" ? "income" : "expense"}`;
        const sign = item.kind === "income" ? "+" : "-";
        const label = truncate(item.description || "(expected)", 44);
        line.textContent = `${label}: ${sign}$${fmtMoney(item.amount)}`;
        line.title = `Expected: ${item.description}`;
        line.addEventListener("click", (e) => {
          e.stopPropagation();
          selectExpectedInstance(item);
        });
        txnsEl.appendChild(line);
      }
    }

    if (showActual) {
      for (const tx of actualTxs) {
        const line = document.createElement("div");
        line.className = `cal-day-tx-line cal-tx-part ${tx.kind === "income" ? "income" : "expense"}`;
        line.dataset.txId = String(tx.id);
        const sign = tx.kind === "income" ? "+" : "-";
        const label = truncate((tx.description || "Transaction").trim(), 44);
        line.textContent = `${label}: ${sign}$${fmtMoney(tx.amount)}`;
        line.title = (tx.description || "").trim() || "Transaction";
        txnsEl.appendChild(line);
      }
    }

    const dayBal = state.monthDailyBalances.get(iso);

    if (dayBal && metricsEl) {
      metricsEl.innerHTML = `<div class="cal-stat cal-balance">Balance: $${fmtMoney(dayBal.end)}</div>`;
    }

    wrapper.appendChild(cell);
  }

  calendarGrid.appendChild(wrapper);

  const calendarPanel = document.getElementById("calendarPanel");
  if (calendarPanel) {
    const weekRows = Math.ceil((offset + daysInMonth) / 7);
    calendarPanel.style.setProperty("--cal-week-rows", String(weekRows));
    calendarPanel.style.setProperty("--cal-day-min-h", weekRows <= 4 ? "96px" : "118px");
  }
}

function drawProjectionChart(daily) {
  if (!projectionChartCanvas) return;
  const items = daily || [];
  const ctx = projectionChartCanvas.getContext("2d");
  if (!ctx) return;

  const w = projectionChartCanvas.clientWidth;
  const h = projectionChartCanvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  projectionChartCanvas.width = Math.floor(w * dpr);
  projectionChartCanvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);

  if (items.length < 2) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("No data", 14, 24);
    return;
  }

  const balances = items.map((d) => Number(d.total_balance ?? 0));
  let minY = Math.min(...balances);
  let maxY = Math.max(...balances);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  const leftPad = 8;
  const rightPad = 8;
  const topPad = 6;
  const bottomPad = 18;

  const plotW = w - leftPad - rightPad;
  const plotH = h - topPad - bottomPad;

  const points = items.map((_, i) => {
    const x = leftPad + (plotW * i) / (items.length - 1);
    const v = balances[i];
    const y = topPad + ((maxY - v) / (maxY - minY)) * plotH;
    return { x, y };
  });

  // Light horizontal grid (Google Finance–style: few lines)
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const y = topPad + (plotH * g) / 3;
    ctx.beginPath();
    ctx.moveTo(leftPad, y);
    ctx.lineTo(leftPad + plotW, y);
    ctx.stroke();
  }

  // Area fill under the line
  const baseY = topPad + plotH;
  ctx.beginPath();
  ctx.moveTo(points[0].x, baseY);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(points[points.length - 1].x, baseY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, topPad, 0, baseY);
  grad.addColorStop(0, "rgba(102,163,255,0.28)");
  grad.addColorStop(0.55, "rgba(102,163,255,0.06)");
  grad.addColorStop(1, "rgba(102,163,255,0)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.strokeStyle = "rgba(102,163,255,0.98)";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  // Start / end values along the bottom (compact)
  const startVal = balances[0];
  const endVal = balances[balances.length - 1];
  ctx.font = "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillStyle = "rgba(159,176,208,0.95)";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(`Start $${fmtMoney(startVal)}`, leftPad, h - 4);
  ctx.textAlign = "right";
  ctx.fillText(`End $${fmtMoney(endVal)}`, w - rightPad, h - 4);
  ctx.textAlign = "left";
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
}

main().catch((e) => {
  if (userPill) userPill.textContent = "Not connected";
  const m = e.message || "Failed to load app";
  show(familiesErr, m);
  show(txErr, m);
});

