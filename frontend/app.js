async function api(path, method = "GET", body) {
  const apiBase = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  const fullPath = `${apiBase}${path}`;
  const res = await fetch(fullPath, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

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
const addAccountBtn = document.getElementById("addAccountBtn");

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

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", "POST");
  window.location.href = "./login.html";
});

document.getElementById("refreshBtn").addEventListener("click", async () => {
  // Keep list + calendar aligned.
  if (calendarMonth) calendarMonth.value = monthInput.value;
  await loadMonthAndCalendar();
});

if (calendarMonth) {
  calendarMonth.addEventListener("change", async () => {
    if (monthInput) monthInput.value = calendarMonth.value;
    await loadMonthAndCalendar();
  });
}

if (calendarMode) {
  calendarMode.addEventListener("change", () => {
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

    if (!name) throw new Error("Account name is required");
    if (startingBalanceVal === "" || Number.isNaN(Number(startingBalanceVal))) throw new Error("Starting balance is required");

    await api(`/api/families/${state.activeFamilyId}/accounts`, "POST", {
      name,
      type,
      starting_balance: Number(startingBalanceVal),
    });

    accountName.value = "";
    accountStartingBalance.value = "";
    await loadAccounts();
  } catch (e) {
    show(accErr, e.message || "Failed to add account");
  }
});

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
    el.innerHTML = `
      <div class="left">
        <div class="desc">${escapeHtml(a.name)}</div>
        <div class="meta">${typeLabel} · Starting: $${fmtMoney(a.starting_balance)}</div>
      </div>
      <div class="amt">${fmtMoney(a.starting_balance)}</div>
    `;
    accountsList.appendChild(el);
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

async function loadMonthAndCalendar() {
  if (!state.activeFamilyId) return;
  await loadTransactions();
  await loadExpectedCalendar();
  renderCalendar();
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

  const actualByDate = new Map(); // iso -> {incomeSum, expenseSum}
  for (const tx of state.monthActualItems || []) {
    const key = tx.date;
    if (!actualByDate.has(key)) actualByDate.set(key, { incomeSum: 0, expenseSum: 0 });
    const sums = actualByDate.get(key);
    const amt = Number(tx.amount || 0);
    if (tx.kind === "income") sums.incomeSum += amt;
    else sums.expenseSum += amt;
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
    cell.innerHTML = `<div class="cal-daynum">${dayNum}</div><div class="cal-badges"></div>`;
    const badgesEl = cell.querySelector(".cal-badges");

    if (showActual) {
      const sums = actualByDate.get(iso);
      if (sums?.incomeSum > 0) {
        const b = document.createElement("div");
        b.className = "badge actual-income";
        b.textContent = `Actual +$${fmtMoney(sums.incomeSum)}`;
        badgesEl.appendChild(b);
      }
      if (sums?.expenseSum > 0) {
        const b = document.createElement("div");
        b.className = "badge actual-expense";
        b.textContent = `Actual -$${fmtMoney(sums.expenseSum)}`;
        badgesEl.appendChild(b);
      }
    }

    if (showExpected) {
      const items = expectedByDate.get(iso) || [];
      const shown = items.slice(0, 3);
      for (const item of shown) {
        const kindClass = item.kind === "income" ? "expected-income" : "expected-expense";
        const b = document.createElement("div");
        b.className = `badge ${kindClass}`;
        const sign = item.kind === "income" ? "+" : "-";
        b.textContent = `${sign}$${fmtMoney(item.amount)} · ${truncate(item.description, 18)}`;
        b.title = `Expected: ${item.description}`;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          selectExpectedInstance(item);
        });
        badgesEl.appendChild(b);
      }
      if (items.length > 3) {
        const more = document.createElement("div");
        more.className = "badge disabled";
        more.textContent = `+${items.length - 3} more`;
        badgesEl.appendChild(more);
      }
    }

    wrapper.appendChild(cell);
  }

  calendarGrid.appendChild(wrapper);
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

  const leftPad = 44;
  const rightPad = 12;
  const topPad = 16;
  const bottomPad = 28;

  const plotW = w - leftPad - rightPad;
  const plotH = h - topPad - bottomPad;

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = topPad + (plotH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(leftPad, y);
    ctx.lineTo(leftPad + plotW, y);
    ctx.stroke();
  }

  // Polyline
  ctx.strokeStyle = "rgba(102,163,255,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < items.length; i++) {
    const x = leftPad + (plotW * i) / (items.length - 1);
    const v = balances[i];
    const y = topPad + ((maxY - v) / (maxY - minY)) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Start/end labels
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  const startVal = balances[0];
  const endVal = balances[balances.length - 1];
  ctx.fillText(`Start: $${fmtMoney(startVal)}`, 10, 16);
  ctx.fillText(`End: $${fmtMoney(endVal)}`, 10, h - 12);
}

function setDefaultMonth() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  monthInput.value = `${d.getFullYear()}-${m}`;
  if (calendarMonth) calendarMonth.value = monthInput.value;
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

async function main() {
  const apiBase = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
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
  show(txErr, e.message || "Failed to load app");
});

