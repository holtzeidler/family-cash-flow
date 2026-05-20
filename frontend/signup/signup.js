function getApiBase() {
  const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  return b.replace(/\/$/, "");
}

/** Show/hide password fields (account setup + signup). */
function initPasswordVisibilityToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach((btn) => {
    if (btn.dataset.bwPwToggleInit === "1") return;
    btn.dataset.bwPwToggleInit = "1";
    const inputId = btn.getAttribute("aria-controls");
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;
    const showLabel = "Show password";
    const hideLabel = "Hide password";
    btn.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      btn.setAttribute("aria-pressed", visible ? "false" : "true");
      btn.setAttribute("aria-label", visible ? showLabel : hideLabel);
      btn.title = visible ? showLabel : hideLabel;
    });
  });
}
initPasswordVisibilityToggles();

/** Cross-site cookie fallback (GitHub Pages → API); cleared on logout / 401. */
const BW_API_ACCESS_TOKEN_KEY = "bw_api_access_token";
const BW_FORECAST_READY_POPUP_KEY = "bw_forecast_ready_popup";

function apiBearerAuthHeaders() {
  try {
    const t = sessionStorage.getItem(BW_API_ACCESS_TOKEN_KEY);
    if (t && String(t).trim()) return { Authorization: `Bearer ${String(t).trim()}` };
  } catch (_) {}
  return {};
}

async function request(path, method, body) {
  const apiBase = getApiBase();
  const fullPath = `${apiBase}${path}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(fullPath, {
      method,
      headers: {
        ...apiBearerAuthHeaders(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}
    return {
      ok: res.ok,
      status: res.status,
      data,
      elapsedMs: Date.now() - startedAt,
      networkError: null,
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      elapsedMs: Date.now() - startedAt,
      networkError: (e && e.message) || "Network error",
    };
  }
}

async function requestWithRetry(path, method, body, { maxMs = 9000, minDelayMs = 260 } = {}) {
  const started = Date.now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    const r = await request(path, method, body);
    if (r.ok) return r;
    // Only retry on network-level failures (cold start / transient fetch issues).
    if (!r.networkError) return r;
    const elapsed = Date.now() - started;
    if (elapsed >= maxMs) return r;
    // Back off quickly but cap so we still make several attempts.
    const delay = Math.min(1500, minDelayMs * attempt);
    await new Promise((res) => window.setTimeout(res, delay));
  }
}

/** FastAPI may return `detail` as a string, object, or list of validation errors. */
function formatApiDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = [];
    for (const item of detail) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const loc = Array.isArray(item.loc) ? item.loc.filter((x) => x !== "body").join(".") : "";
        const m = item.msg != null ? String(item.msg) : "";
        if (loc && m) parts.push(`${loc}: ${m}`);
        else if (m) parts.push(m);
      }
    }
    return parts.filter(Boolean).join(" ");
  }
  if (typeof detail === "object") {
    if (detail.msg != null) return String(detail.msg);
    if (detail.message != null) return String(detail.message);
    try {
      return JSON.stringify(detail);
    } catch (_) {
      return String(detail);
    }
  }
  return String(detail);
}

function calloutText(msg, fallback = "Something went wrong. Please try again.") {
  if (msg == null || msg === "") return "";
  if (typeof msg === "string") return msg;
  const formatted = formatApiDetail(msg);
  return formatted || fallback;
}

function setCallout(el, msg, mode = "pending") {
  if (!el) return;
  const text = calloutText(msg);
  el.textContent = text;
  el.className = mode ? `callout callout--${mode}` : "callout";
  el.style.display = text ? "block" : "none";
}

async function goApp() {
  try {
    const t = sessionStorage.getItem("bw_invite_token");
    if (!t || !String(t).trim()) {
      window.location.replace("/calendar");
      return;
    }
    const enc = encodeURIComponent(String(t).trim());
    const [me, inv] = await Promise.all([
      request("/api/auth/me", "GET"),
      request(`/api/public/invites/by-token/${enc}`, "GET"),
    ]);
    if (!inv.ok || !inv.data || !inv.data.ok) {
      try {
        sessionStorage.removeItem("bw_invite_token");
      } catch (_) {}
      window.location.replace("/calendar");
      return;
    }
    const invited = String(inv.data.invitee_email || "")
      .trim()
      .toLowerCase();
    const logged =
      me.ok && me.data && me.data.user && me.data.user.email
        ? String(me.data.user.email)
            .trim()
            .toLowerCase()
        : "";
    if (logged && invited && logged !== invited) {
      window.location.replace("/invite/?token=" + enc);
      return;
    }
    window.location.replace("/invite/?token=" + enc);
  } catch (_) {
    window.location.replace("/calendar");
  }
}

function messageFromFailure(resp, fallback) {
  if (resp.networkError) {
    const raw = String(resp.networkError || "").trim();
    const norm = raw.toLowerCase();
    if (
      norm.includes("failed to fetch") ||
      norm.includes("networkerror") ||
      norm.includes("load failed") ||
      norm.includes("the internet connection appears to be offline")
    ) {
      return "We’re having trouble connecting. Please wait a moment and try again.";
    }
    return "We hit a network issue. Please try again.";
  }
  if (resp.status === 409) return "Email already registered.";
  if (resp.status === 400 && resp.data && resp.data.detail) {
    const msg = formatApiDetail(resp.data.detail);
    if (msg) return msg;
  }
  if (resp.status >= 500) return `Server error (${resp.status}). Try again in 30–60s.`;
  if (resp.data && resp.data.detail) {
    const msg = formatApiDetail(resp.data.detail);
    if (msg) return msg;
  }
  if (resp.data && typeof resp.data.message === "string" && resp.data.message.trim()) {
    return resp.data.message.trim();
  }
  return fallback;
}

async function verifySessionWithProgress(targetInfoEl, opts = {}) {
  const silent = !!(opts && opts.silent);
  const onStatus = opts && typeof opts.onStatus === "function" ? opts.onStatus : null;
  const attempts = silent ? [0, 350, 900] : [0, 800, 1800, 3200];
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) await new Promise((resolve) => setTimeout(resolve, attempts[i]));
    const status = "Confirming your session…";
    if (onStatus) onStatus(status);
    else if (!silent) setCallout(targetInfoEl, "Logging in....", "pending");
    const me = await request("/api/auth/me", "GET");
    if (me.ok && me.data && me.data.user) return { ok: true };
  }
  return { ok: false };
}

function prefetchCalendarPage() {
  try {
    if (document.querySelector('link[data-bw-prefetch="calendar"]')) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = "/calendar/";
    link.setAttribute("data-bw-prefetch", "calendar");
    document.head.appendChild(link);
  } catch (_) {}
}

async function ensureMinOverlayDuration(startedAt, minMs) {
  const remaining = minMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

function parsePlanFromQuery() {
  try {
    const p = new URLSearchParams(window.location.search);
    const v = String(p.get("plan") || "").trim().toLowerCase();
    return v === "pro" || v === "base" ? v : "";
  } catch (_) {
    return "";
  }
}

function persistBillingSelectionFromQuery() {
  const plan = parsePlanFromQuery();
  if (!plan) return;
  try {
    localStorage.setItem("bw_billing_plan", plan);
    localStorage.setItem("bw_billing_frequency", "monthly");
  } catch (_) {}
}

const signupCalloutEl = document.getElementById("signupCallout");
const signupPlanNoteEl = document.getElementById("signupPlanNote");
const signupBannerHead = document.getElementById("signupBannerHead");
const signupBtn = document.getElementById("signupBtn");
const accountSetupAccountSectionEl = document.getElementById("accountSetupAccountSection");
const accountSetupTransactionsSectionEl = document.getElementById("accountSetupTransactionsSection");
const addMoreTxBtn = document.getElementById("addMoreTxBtn");
const accountSetupBackBtn = document.getElementById("accountSetupBackBtn");
const accountSetupSkipBtn = document.getElementById("accountSetupSkipBtn");

const BW_ACCOUNT_SETUP_DRAFT_KEY = "bw_account_setup_draft";

function writeAccountSetupDraftStorage(json) {
  try {
    sessionStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, json);
  } catch (_) {}
  try {
    localStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, json);
  } catch (_) {}
}

function persistAccountSetupDraftObject(obj) {
  writeAccountSetupDraftStorage(JSON.stringify(obj));
}

function removeAccountSetupDraftStorage() {
  try {
    sessionStorage.removeItem(BW_ACCOUNT_SETUP_DRAFT_KEY);
  } catch (_) {}
  try {
    localStorage.removeItem(BW_ACCOUNT_SETUP_DRAFT_KEY);
  } catch (_) {}
}

function accountSetupDraftTxFingerprint(t) {
  if (!t || typeof t !== "object") return "";
  return [
    String(t.kind || "").trim().toLowerCase(),
    Number(t.amount),
    String(t.date || "").trim(),
    String(t.category || "").trim().toLowerCase(),
  ].join("|");
}

/** Union income/expense rows from two persisted copies (session vs local). */
function mergeAccountSetupDraftTransactions(a, b) {
  const out = [];
  const seen = new Set();
  for (const t of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const fp = accountSetupDraftTxFingerprint(t);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    out.push(t);
  }
  return out;
}

function draftAccountIsComplete(account) {
  return !!(account && account.name && account.starting_balance_date != null);
}

/** Prefer the copy that has account + the most transactions; union transaction lists. */
function mergeAccountSetupDraftObjects(sessionObj, localObj) {
  if (!sessionObj || typeof sessionObj !== "object") return localObj;
  if (!localObj || typeof localObj !== "object") return sessionObj;
  const sessionTx = Array.isArray(sessionObj.transactions) ? sessionObj.transactions : [];
  const localTx = Array.isArray(localObj.transactions) ? localObj.transactions : [];
  const transactions = mergeAccountSetupDraftTransactions(sessionTx, localTx);
  const sessionAccount = draftAccountIsComplete(sessionObj.account) ? sessionObj.account : null;
  const localAccount = draftAccountIsComplete(localObj.account) ? localObj.account : null;
  const account = sessionAccount || localAccount || localObj.account || sessionObj.account || null;
  const sessionSurvey = Array.isArray(sessionObj.surveyHelpWith) ? sessionObj.surveyHelpWith : [];
  const localSurvey = Array.isArray(localObj.surveyHelpWith) ? localObj.surveyHelpWith : [];
  const surveyHelpWith = localSurvey.length >= sessionSurvey.length ? localSurvey : sessionSurvey;
  const sessionV = Number(sessionObj.wizardFlowVersion);
  const localV = Number(localObj.wizardFlowVersion);
  const wizardFlowVersion =
    Number.isFinite(sessionV) && Number.isFinite(localV)
      ? Math.max(sessionV, localV)
      : Number.isFinite(localV)
        ? localV
        : Number.isFinite(sessionV)
          ? sessionV
          : ACCOUNT_SETUP_WIZARD_FLOW_VERSION;
  const sessionStep = Number(sessionObj.wizardStep);
  const localStep = Number(localObj.wizardStep);
  const wizardStep =
    Number.isFinite(sessionStep) && Number.isFinite(localStep) ? Math.max(sessionStep, localStep) : localObj.wizardStep ?? sessionObj.wizardStep;
  return {
    ...sessionObj,
    ...localObj,
    wizardFlowVersion,
    wizardStep,
    account,
    transactions,
    surveyHelpWith,
    surveyOther: localObj.surveyOther != null && String(localObj.surveyOther).trim() !== "" ? localObj.surveyOther : sessionObj.surveyOther,
  };
}

/** Recurring/one-time rows must start on or after the account starting-balance date (API rule). */
function accountSetupEffectiveTxDate(txDate, draft) {
  const d = String(txDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const acctStart = String(draft?.account?.starting_balance_date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(acctStart) && d < acctStart) return acctStart;
  return d;
}

function readAccountSetupDraftJsonFromStorage() {
  let sessionRaw = "";
  let localRaw = "";
  try {
    sessionRaw = sessionStorage.getItem(BW_ACCOUNT_SETUP_DRAFT_KEY) || "";
  } catch (_) {}
  try {
    localRaw = localStorage.getItem(BW_ACCOUNT_SETUP_DRAFT_KEY) || "";
  } catch (_) {}
  if (!sessionRaw && !localRaw) return "";
  if (!sessionRaw) return localRaw;
  if (!localRaw) return sessionRaw;
  if (sessionRaw === localRaw) return sessionRaw;
  try {
    const sessionObj = JSON.parse(sessionRaw);
    const localObj = JSON.parse(localRaw);
    return JSON.stringify(mergeAccountSetupDraftObjects(sessionObj, localObj));
  } catch (_) {
    return sessionRaw || localRaw;
  }
}

/** Bumped when step order changes; used to migrate persisted `wizardStep`. */
const ACCOUNT_SETUP_WIZARD_FLOW_VERSION = 3;
/** Logical wizard step (0–4) → `accountSetupWizardPanel{N}` — email, checking, income, expense, survey (last). */
const ACCOUNT_SETUP_PANEL_FOR_STEP = [0, 1, 2, 3, 4];
/** v2 order was email → survey → checking → income → expense (`wizardStep` index). Maps step → panel index. */
const V2_ACCOUNT_SETUP_PANEL_FOR_STEP = [0, 4, 1, 2, 3];

/** Pre–survey-as-step-1 layout: [email, checking, income, expense, survey] → v2 step indices. */
const LEGACY_ACCOUNT_SETUP_WIZARD_STEP_TO_NEW = [0, 2, 3, 4, 1];
function normalizePersistedAccountSetupWizardStep(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const v = Number(o.wizardFlowVersion);
  const ws = Number(o.wizardStep);
  if (v === ACCOUNT_SETUP_WIZARD_FLOW_VERSION) {
    return Number.isFinite(ws) && ws >= 0 && ws <= 4 ? ws : 0;
  }
  if (v === 2 && Number.isFinite(ws) && ws >= 0 && ws <= 4) {
    const panel = V2_ACCOUNT_SETUP_PANEL_FOR_STEP[ws];
    return Number.isFinite(panel) ? panel : 0;
  }
  if (Number.isFinite(ws) && ws >= 0 && ws <= 4) {
    const v2 = LEGACY_ACCOUNT_SETUP_WIZARD_STEP_TO_NEW[ws];
    if (!Number.isFinite(v2)) return 0;
    const panel = V2_ACCOUNT_SETUP_PANEL_FOR_STEP[v2];
    return Number.isFinite(panel) ? panel : 0;
  }
  return 0;
}

/** Account setup wizard: category list (value = stored description id). */
const ACCOUNT_SETUP_CATEGORY_ITEMS = [
  { kind: "income", group: "Income & reimbursements", value: "Paycheck", label: "Paycheck" },
  { kind: "income", group: "Income & reimbursements", value: "Reimbursement", label: "Reimbursement" },
  { kind: "income", group: "Income & reimbursements", value: "Transfer In", label: "Transfer In" },
  { kind: "income", group: "Income & reimbursements", value: "Other Income", label: "Other Income" },
  { kind: "expense", group: "Home", value: "Mortgage/Rent", label: "Mortgage/Rent" },
  { kind: "expense", group: "Home", value: "Home Maintenance", label: "Home Maintenance" },
  { kind: "expense", group: "Home", value: "Utility", label: "Utility" },
  { kind: "expense", group: "Loans & payments", value: "Car Loan", label: "Car Loan" },
  { kind: "expense", group: "Loans & payments", value: "Credit Card Payment", label: "Credit Card Payment" },
  { kind: "expense", group: "Transfers & investing", value: "Transfers", label: "Transfers" },
  { kind: "expense", group: "Transfers & investing", value: "Investment", label: "Investment" },
  { kind: "expense", group: "Transfers & investing", value: "Cash & ATM", label: "Cash & ATM" },
  { kind: "expense", group: "Other", value: "Insurance", label: "Insurance" },
  { kind: "expense", group: "Other", value: "Subscription", label: "Subscription" },
  { kind: "expense", group: "Other", value: "Charity", label: "Charity" },
  { kind: "expense", group: "Other", value: "Gifts", label: "Gifts" },
  { kind: "expense", group: "Other", value: "Miscellaneous", label: "Miscellaneous" },
];

function escapeHtmlPlain(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegexChars(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightCategoryLabel(label, query) {
  const esc = escapeHtmlPlain(label);
  const q = query.trim();
  if (!q) return esc;
  const re = new RegExp(`(${escapeRegexChars(q)})`, "gi");
  return esc.replace(re, "<mark>$1</mark>");
}

function rankCategorySearch(query, item) {
  const q = query.trim().toLowerCase();
  const label = item.label.toLowerCase();
  const group = (item.group || "").toLowerCase();
  if (!q) return 1;
  if (label === q) return 100000;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length && tokens.every((t) => label.includes(t))) return 95000;
  if (label.startsWith(q)) return 92000;
  if (tokens.length && tokens.every((t) => label.includes(t) || group.includes(t))) return 88000;
  if (label.includes(q)) return 85000;
  if (group.includes(q)) return 80000;
  const words = label.split(/[\s/&,\-]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(q))) return 75000;
  let qi = 0;
  for (let li = 0; li < label.length && qi < q.length; li++) {
    if (label[li] === q[qi]) qi++;
  }
  if (qi === q.length) return 50000;
  return 0;
}

function getAccountSetupCategoryKindForHiddenId(hiddenId) {
  if (hiddenId === "asTxCategory") {
    return String(document.querySelector('input[name="asTxKind"]:checked')?.value || "")
      .trim()
      .toLowerCase();
  }
  if (hiddenId === "asExpTxCategory") {
    return String(document.querySelector('input[name="asExpTxKind"]:checked')?.value || "")
      .trim()
      .toLowerCase();
  }
  return "";
}

function getAccountSetupCategoryItemsForKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!normalized) return [...ACCOUNT_SETUP_CATEGORY_ITEMS];
  return ACCOUNT_SETUP_CATEGORY_ITEMS.filter((item) => String(item.kind || "").trim().toLowerCase() === normalized);
}

/** Preset row must match txn kind; custom labels are bound via data-as-category-kind on the hidden input. */
function accountSetupStoredCategoryMatchesKind(hidden, kind) {
  if (!hidden) return true;
  const normalizedKind = String(kind || "").trim().toLowerCase();
  const current = String(hidden.value || "").trim();
  if (!current || !normalizedKind) return true;
  const item =
    ACCOUNT_SETUP_CATEGORY_ITEMS.find((e) => e.value === current) ||
    ACCOUNT_SETUP_CATEGORY_ITEMS.find((e) => e.label.trim().toLowerCase() === current.toLowerCase());
  if (item) return String(item.kind || "").trim().toLowerCase() === normalizedKind;
  const bound = String(hidden.dataset.asCategoryKindForCustom || "").trim().toLowerCase();
  if (bound) return bound === normalizedKind;
  return true;
}

function accountSetupCategoryExactMatchItem(query, kind) {
  const raw = String(query || "").trim();
  const k = String(kind || "").trim().toLowerCase();
  if (!raw || !k) return null;
  const items = getAccountSetupCategoryItemsForKind(k);
  const low = raw.toLowerCase();
  return (
    items.find((i) => i.label.trim().toLowerCase() === low) ||
    items.find((i) => String(i.value || "").trim().toLowerCase() === low) ||
    null
  );
}

function bindAccountSetupCategoryKindFromTxn(hiddenEl, categoryStr, txnKind) {
  if (!hiddenEl) return;
  const c = String(categoryStr || "").trim();
  delete hiddenEl.dataset.asCategoryKindForCustom;
  if (!c || c === "Uncategorized") return;
  const item =
    ACCOUNT_SETUP_CATEGORY_ITEMS.find((e) => e.value === c) ||
    ACCOUNT_SETUP_CATEGORY_ITEMS.find((e) => e.label.trim().toLowerCase() === c.toLowerCase());
  if (!item) hiddenEl.dataset.asCategoryKindForCustom = String(txnKind || "").trim().toLowerCase();
}

function filterCategoriesForSearch(query, kind = "") {
  const items = getAccountSetupCategoryItemsForKind(kind);
  const q = query.trim();
  if (!q) return items;
  const scored = items.map((item) => ({
    item,
    score: rankCategorySearch(query, item),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.map((x) => x.item);
}

function accountSetupSyncCategorySearchDisplay(hiddenId) {
  const hidden = document.getElementById(hiddenId);
  const inputId = hiddenId === "asTxCategory" ? "asTxCategorySearch" : "asExpTxCategorySearch";
  const input = document.getElementById(inputId);
  if (!hidden || !input) return;
  const v = String(hidden.value || "").trim();
  if (!v) {
    input.value = "";
    return;
  }
  const item = ACCOUNT_SETUP_CATEGORY_ITEMS.find((i) => i.value === v);
  input.value = item ? item.label : v;
}

function clearAccountSetupCategoryCombobox(hiddenId) {
  const inputId = hiddenId === "asTxCategory" ? "asTxCategorySearch" : "asExpTxCategorySearch";
  const listId = hiddenId === "asTxCategory" ? "asTxCategoryList" : "asExpTxCategoryList";
  const hidden = document.getElementById(hiddenId);
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (hidden) {
    hidden.value = "";
    delete hidden.dataset.asCategoryKindForCustom;
  }
  if (input) input.value = "";
  if (list) {
    list.hidden = true;
    list.innerHTML = "";
  }
  if (input) input.setAttribute("aria-expanded", "false");
}

function initAccountSetupCategoryCombobox(hiddenId, inputId, listId) {
  const hidden = document.getElementById(hiddenId);
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!hidden || !input || !list || input.dataset.categoryComboInit === "1") return;
  input.dataset.categoryComboInit = "1";

  let activeIdx = -1;

  function optionElements() {
    return [...list.querySelectorAll(".category-search__option")];
  }

  function setActive(i) {
    const opts = optionElements();
    if (!opts.length) return;
    activeIdx = Math.max(0, Math.min(i, opts.length - 1));
    opts.forEach((el, j) => el.classList.toggle("category-search__option--active", j === activeIdx));
  }

  function commit(item) {
    const isCustom = !!(item && item.isCustom);
    if (isCustom) {
      hidden.dataset.asCategoryKindForCustom = getAccountSetupCategoryKindForHiddenId(hiddenId);
    } else {
      delete hidden.dataset.asCategoryKindForCustom;
    }
    hidden.value = item.value;
    input.value = item.label;
    list.hidden = true;
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function resolveInputOnBlur() {
    const raw = input.value.trim();
    const allowedKind = getAccountSetupCategoryKindForHiddenId(hiddenId);
    if (!raw) {
      hidden.value = "";
      delete hidden.dataset.asCategoryKindForCustom;
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const exactPreset = accountSetupCategoryExactMatchItem(raw, allowedKind);
    if (exactPreset) {
      commit(exactPreset);
      return;
    }
    const ranked = filterCategoriesForSearch(raw, allowedKind);
    if (ranked.length === 1) {
      commit(ranked[0]);
      return;
    }
    const cur = ACCOUNT_SETUP_CATEGORY_ITEMS.find((i) => i.value === hidden.value);
    if (cur && cur.label.trim() !== input.value.trim()) {
      hidden.value = "";
      delete hidden.dataset.asCategoryKindForCustom;
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function renderDropdown() {
    const q = input.value;
    const allowedKind = getAccountSetupCategoryKindForHiddenId(hiddenId);
    const items = filterCategoriesForSearch(q, allowedKind);
    list.innerHTML = "";
    let lastGroup = null;
    items.forEach((item) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const gl = document.createElement("li");
        gl.className = "category-search__group-label";
        gl.setAttribute("role", "presentation");
        gl.textContent = item.group;
        list.appendChild(gl);
      }
      const li = document.createElement("li");
      li.className = "category-search__option";
      li.setAttribute("role", "option");
      li.innerHTML = highlightCategoryLabel(item.label, q);
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", () => commit(item));
      list.appendChild(li);
    });
    const rawQ = q.trim();
    if (rawQ && !accountSetupCategoryExactMatchItem(rawQ, allowedKind)) {
      const addLi = document.createElement("li");
      addLi.className = "category-search__option category-search__option--create";
      addLi.setAttribute("role", "option");
      addLi.dataset.createName = rawQ;
      const safe = escapeHtmlPlain(rawQ);
      addLi.innerHTML = `<span class="category-search__plus" aria-hidden="true">+</span><span class="category-search__create-text">Add “${safe}” as new category</span>`;
      addLi.addEventListener("mousedown", (e) => e.preventDefault());
      addLi.addEventListener("click", () => commit({ value: rawQ, label: rawQ, isCustom: true }));
      list.appendChild(addLi);
    }
    const opts = optionElements();
    activeIdx = opts.length ? 0 : -1;
    opts.forEach((el, j) => el.classList.toggle("category-search__option--active", j === activeIdx));
  }

  input.addEventListener("focus", () => {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderDropdown();
  });

  input.addEventListener("input", () => {
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderDropdown();
  });

  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      resolveInputOnBlur();
    }, 180);
  });

  input.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "Escape") {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      accountSetupSyncCategorySearchDisplay(hiddenId);
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) {
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        renderDropdown();
      } else {
        const o2 = optionElements();
        if (o2.length) setActive(activeIdx + 1);
      }
      return;
    }
    if (k === "ArrowUp") {
      e.preventDefault();
      if (!list.hidden) {
        const o2 = optionElements();
        if (o2.length) setActive(activeIdx - 1);
      }
      return;
    }
    if (k === "Enter") {
      const allowedKind = getAccountSetupCategoryKindForHiddenId(hiddenId);
      const items = filterCategoriesForSearch(input.value, allowedKind);
      const opts = optionElements();
      if (!list.hidden && opts.length && activeIdx >= 0 && activeIdx < opts.length) {
        e.preventDefault();
        const el = opts[activeIdx];
        if (el.classList.contains("category-search__option--create")) {
          const nm = String(el.dataset.createName || "").trim();
          if (nm) commit({ value: nm, label: nm, isCustom: true });
        } else if (activeIdx < items.length) {
          commit(items[activeIdx]);
        }
      }
    }
  });

  accountSetupSyncCategorySearchDisplay(hiddenId);
}

// Prefetch check-email during Step 0 so Enter→Next feels instant.
const BW_EMAIL_CHECK_CACHE_MS = 5 * 60 * 1000;
let bwEmailCheckCache = { email: "", checkedAt: 0, exists: null, pending: null };
/** Bumped when final signup starts so a slow Step-0 precheck cannot modal after register succeeds. */
let bwEmailPrecheckStep0Generation = 0;
let bwSignupInFlight = false;

function hasSignupAccessToken() {
  try {
    const t = sessionStorage.getItem(BW_API_ACCESS_TOKEN_KEY);
    return !!(t && String(t).trim());
  } catch (_) {
    return false;
  }
}

function shouldShowDuplicateEmailModalFromPrecheck() {
  if (bwSignupInFlight) return false;
  if (hasSignupAccessToken()) return false;
  return true;
}

function clearEmailCheckCache() {
  bwEmailCheckCache = { email: "", checkedAt: 0, exists: null, pending: null };
}

/** Always hits the API (no stale "available" cache) before register. */
async function precheckEmailExistsFresh(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  if (bwEmailCheckCache.email === e) clearEmailCheckCache();
  return precheckEmailExists(email);
}

async function precheckEmailExists(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  const now = Date.now();
  if (bwEmailCheckCache.email === e && bwEmailCheckCache.pending) return bwEmailCheckCache.pending;
  if (bwEmailCheckCache.email === e && bwEmailCheckCache.exists != null && now - bwEmailCheckCache.checkedAt < BW_EMAIL_CHECK_CACHE_MS) {
    return { ok: true, exists: !!bwEmailCheckCache.exists, cached: true };
  }
  bwEmailCheckCache = { email: e, checkedAt: 0, exists: null, pending: null };
  const p = (async () => {
    const chk = await request("/api/auth/check-email", "POST", { email: e });
    const stillCurrent = () => bwEmailCheckCache.email === e && bwEmailCheckCache.pending === p;
    if (chk.ok) {
      const exists = !!(chk.data && chk.data.exists === true);
      if (stillCurrent()) {
        bwEmailCheckCache = { email: e, checkedAt: Date.now(), exists, pending: null };
      }
      return { ok: true, exists, cached: false };
    }
    if (stillCurrent()) bwEmailCheckCache = { email: e, checkedAt: 0, exists: null, pending: null };
    return { ok: false, exists: null, cached: false };
  })();
  bwEmailCheckCache.pending = p;
  return p;
}

/** Shorter debounce once the address looks complete so the prefetch often finishes before Next. */
function emailLooksPlausibleForPrecheckDebounce(em) {
  const s = String(em || "").trim();
  if (s.length < 6 || !s.includes("@")) return false;
  const at = s.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = s.slice(at + 1);
  return domain.includes(".") && domain.length >= 3;
}

/** Fire-and-forget request to reduce perceived latency when the hosting provider cold-starts the API. */
function scheduleAuthApiWarmup() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  const apiBase = getApiBase();
  if (!apiBase) return;
  const run = () => {
    void fetch(`${apiBase}/api/auth/check-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: "bw-api-warmup@example.com" }),
    }).catch(() => {});
  };
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
  else window.setTimeout(run, 0);
}

function accountSetupStep0FieldsPassClientGate() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return false;
  if (getAccountSetupWizardStep() !== 0) return false;
  const email = (document.getElementById("email")?.value || "").trim();
  const password = document.getElementById("password")?.value || "";
  const password2 = document.getElementById("password2")?.value || "";
  if (!email || password.length < 8 || password !== password2) return false;
  return true;
}

/** Overlap network with click / Enter so Next often hits a warm cache or in-flight request. */
function speculativePrecheckEmailIfStep0Ready() {
  if (!accountSetupStep0FieldsPassClientGate()) return;
  const email = (document.getElementById("email")?.value || "").trim();
  void precheckEmailExists(email);
}

function openAccountSetupDuplicateEmailModal() {
  const el = document.getElementById("accountSetupDuplicateEmailModal");
  if (!el) return;
  if (!shouldShowDuplicateEmailModalFromPrecheck()) return;
  try {
    if (getAccountSetupWizardStep() === 0) {
      lockAccountSetupWizardStepTransition();
      document.getElementById("email")?.focus();
    } else {
      lockAccountSetupWizardStepTransition();
      setAccountSetupWizardStep(0);
      document.getElementById("email")?.focus();
    }
  } catch (_) {}
  el.classList.add("modal-overlay--open");
  el.setAttribute("aria-hidden", "false");
}

function closeAccountSetupDuplicateEmailModal() {
  const el = document.getElementById("accountSetupDuplicateEmailModal");
  if (!el) return;
  el.classList.remove("modal-overlay--open");
  el.setAttribute("aria-hidden", "true");
}

(function initAccountSetupDuplicateEmailModal() {
  const m = document.getElementById("accountSetupDuplicateEmailModal");
  if (!m) return;
  const closeBtn = document.getElementById("accountSetupDuplicateEmailClose");
  closeBtn?.addEventListener("click", () => closeAccountSetupDuplicateEmailModal());
  m.addEventListener("click", (e) => {
    if (e.target === m) closeAccountSetupDuplicateEmailModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!m.classList.contains("modal-overlay--open")) return;
    e.preventDefault();
    closeAccountSetupDuplicateEmailModal();
  });
})();

/**
 * Ignore extra primary-button activations right after a wizard step change.
 * A double-click on "Next" from step 0 would otherwise run step 2 (checking) with empty
 * account fields — which is valid — and skip straight to step 3.
 */
let accountSetupWizardStepLockUntil = 0;
function isAccountSetupWizardStepLocked() {
  return performance.now() < accountSetupWizardStepLockUntil;
}
function lockAccountSetupWizardStepTransition(ms = 480) {
  accountSetupWizardStepLockUntil = performance.now() + ms;
}

function getAccountSetupStep3Phase() {
  const p2 = document.getElementById("accountSetupWizardPanel2");
  if (!p2) return "intro";
  return p2.getAttribute("data-step3-phase") === "form" ? "form" : "intro";
}

function persistDraftStep3Phase(phase) {
  try {
    const raw = readAccountSetupDraftRaw() || {};
    raw.step3Phase = phase;
    persistAccountSetupDraftObject(raw);
  } catch (_) {}
}

function setAccountSetupStep3Phase(phase) {
  const p2 = document.getElementById("accountSetupWizardPanel2");
  const intro = document.getElementById("accountSetupWizardStep3Intro");
  const form = document.getElementById("accountSetupWizardStep3Form");
  if (!p2 || !intro || !form) return;
  const isForm = phase === "form";
  p2.setAttribute("data-step3-phase", isForm ? "form" : "intro");
  if (!isForm) {
    p2.dataset.afterSave = "";
  }
  intro.hidden = isForm;
  form.hidden = !isForm;
  persistDraftStep3Phase(isForm ? "form" : "intro");
  syncAccountSetupWizardShellButtons();
  if (isForm) refreshAccountSetupScheduleLayout();
}

function isAccountSetupStep3AfterSave() {
  const p2 = document.getElementById("accountSetupWizardPanel2");
  return !!p2 && p2.dataset.afterSave === "1";
}

function setAccountSetupStep3AfterSave(on) {
  const p2 = document.getElementById("accountSetupWizardPanel2");
  if (!p2) return;
  p2.dataset.afterSave = on ? "1" : "";
  const msg = document.getElementById("accountSetupStep3Success");
  if (msg) msg.hidden = !on;
  syncAccountSetupWizardShellButtons();
}

function getAccountSetupTransactionCounts() {
  let draft = null;
  try { draft = readAccountSetupDraftRaw() || {}; } catch (_) { draft = {}; }
  const txs = Array.isArray(draft.transactions) ? draft.transactions : [];
  let incomeCount = 0;
  let expenseCount = 0;
  for (const tx of txs) {
    const kind = String((tx && tx.kind) || "").trim().toLowerCase();
    if (kind === "income") incomeCount += 1;
    else if (kind === "expense") expenseCount += 1;
  }
  return {
    incomeCount,
    expenseCount,
    totalCount: incomeCount + expenseCount,
  };
}

function formatAccountSetupStep3Summary(incomeCount, expenseCount) {
  const i = Number(incomeCount) || 0;
  const e = Number(expenseCount) || 0;
  if (!i && !e) return "";
  const iPart = i === 1 ? "1 income" : `${i} income`;
  const ePart = e === 1 ? "1 expense" : `${e} expenses`;
  if (i && e) return `✓ ${iPart} added · ✓ ${ePart} added`;
  if (i) return `✓ ${iPart} added`;
  return `✓ ${ePart} added`;
}

function getAccountSetupStep3HubFocusTarget() {
  const { incomeCount, expenseCount, totalCount } = getAccountSetupTransactionCounts();
  if (!incomeCount) return document.getElementById("asTxHubAddIncomeBtn");
  if (!expenseCount) return document.getElementById("asTxHubAddExpenseBtn");
  if (totalCount > 0) return signupBtn || document.getElementById("asTxHubAddExpenseBtn");
  return document.getElementById("asTxHubAddIncomeBtn");
}

function syncAccountSetupStep3HubState() {
  const panel = document.getElementById("accountSetupWizardPanel2");
  const intro = document.getElementById("accountSetupWizardStep3Intro");
  if (!panel || !intro) return;
  const summary = document.getElementById("accountSetupStep3Summary");
  const { incomeCount, expenseCount } = getAccountSetupTransactionCounts();

  if (summary) {
    const text = formatAccountSetupStep3Summary(incomeCount, expenseCount);
    summary.textContent = text;
    summary.hidden = !text;
  }

  const syncAction = (buttonId, count) => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = false;
      button.classList.toggle("is-complete", count > 0);
    }
  };

  syncAction("asTxHubAddIncomeBtn", incomeCount);
  syncAction("asTxHubAddExpenseBtn", expenseCount);
}

function getAccountSetupExpensePhase() {
  const p3 = document.getElementById("accountSetupWizardPanel3");
  if (!p3) return "intro";
  return p3.getAttribute("data-expense-phase") === "form" ? "form" : "intro";
}

function persistDraftExpensePhase(phase) {
  try {
    const raw = readAccountSetupDraftRaw() || {};
    raw.expensePhase = phase;
    persistAccountSetupDraftObject(raw);
  } catch (_) {}
}

function setAccountSetupExpensePhase(phase) {
  const p3 = document.getElementById("accountSetupWizardPanel3");
  const intro = document.getElementById("accountSetupWizardStep4Intro");
  const form = document.getElementById("accountSetupWizardStep4Form");
  if (!p3 || !form) return;
  const isForm = phase === "form";
  p3.setAttribute("data-expense-phase", isForm ? "form" : "intro");
  if (!isForm) {
    p3.dataset.afterSave = "";
  }
  if (intro) intro.hidden = isForm;
  form.hidden = !isForm;
  persistDraftExpensePhase(isForm ? "form" : "intro");
  syncAccountSetupWizardShellButtons();
  if (isForm) refreshAccountSetupScheduleLayout();
}

function isAccountSetupExpenseAfterSave() {
  const p3 = document.getElementById("accountSetupWizardPanel3");
  return !!p3 && p3.dataset.afterSave === "1";
}

function setAccountSetupExpenseAfterSave(on) {
  const p3 = document.getElementById("accountSetupWizardPanel3");
  if (!p3) return;
  p3.dataset.afterSave = on ? "1" : "";
  const msg = document.getElementById("accountSetupStep4Success");
  if (msg) msg.hidden = !on;
  syncAccountSetupWizardShellButtons();
}

function syncAccountSetupBackButtonVisibility() {
  if (!accountSetupBackBtn) return;
  if (!document.getElementById("accountSetupWizard")) return;
  const s = getAccountSetupWizardStep();
  if (s <= 0) {
    accountSetupBackBtn.style.display = "none";
    return;
  }
  if (s === 2 && getAccountSetupStep3Phase() === "form") {
    accountSetupBackBtn.style.display = "none";
    return;
  }
  if (s === 3 && getAccountSetupExpensePhase() === "form") {
    accountSetupBackBtn.style.display = "none";
    return;
  }
  accountSetupBackBtn.style.removeProperty("display");
}

/**
 * Logical step → user-facing "Step N of 4" mapping. The wizard has five logical
 * steps (0..4) but only four perceptible phases — both transaction panels (2 and 3)
 * share Step 3 of 4 because they are the same "recurring items" activity.
 */
function getAccountSetupDisplayStepNumber(step) {
  if (step <= 0) return 1;
  if (step === 1) return 2;
  if (step === 2 || step === 3) return 3;
  return 4;
}

/** Per-step copy. Title + subtitle are intentionally outcome-oriented, not "now…". */
function getAccountSetupStepCopy(step, ctx) {
  const phase3 = ctx && ctx.step3Phase;
  switch (step) {
    case 0:
      return {
        title: "Create your login",
        subtitle: "Start with an email and password.",
      };
    case 1:
      return {
        title: "Start with your current checking balance",
        subtitle: "Use today’s balance so your forecast starts from reality.",
      };
    case 2: {
      if (phase3 === "form") {
        return {
          title: "Add an upcoming paycheck or bill",
          subtitle: "A few recurring items are usually enough to see what stays covered.",
        };
      }
      return {
        title: "Add your first income & expenses",
        subtitle: "You’re almost done — a paycheck and a bill are enough to see your forecast take shape.",
      };
    }
    case 3:
      return {
        title: "Add another recurring item",
        subtitle: "Utilities, card payments, and transfers all help make your projected balance more accurate.",
      };
    case 4:
      return {
        title: "What matters most to you?",
        subtitle: "Your forecast is ready—pick what you want help with first.",
      };
    default:
      return { title: "Let’s build your forecast", subtitle: "Start simple. You can refine everything later." };
  }
}

function syncAccountSetupWizardShellButtons() {
  const s = getAccountSetupWizardStep();
  const stepLabel = document.getElementById("accountSetupWizardStepLabel");
  const eyebrow = document.getElementById("accountSetupWizardEyebrow");
  const reassurance = document.getElementById("accountSetupWizardReassurance");
  const subEyebrow = document.getElementById("accountSetupWizardSubeyebrow");
  const saveInc = document.getElementById("asTxSaveIncomeBtn");
  const cancelInc = document.getElementById("asTxCancelIncomeBtn");
  const saveExp = document.getElementById("asExpSaveBtn");
  const cancelExp = document.getElementById("asExpCancelBtn");
  const hubAddIncome = document.getElementById("asTxHubAddIncomeBtn");
  const hubAddExpense = document.getElementById("asTxHubAddExpenseBtn");
  const successAddExpense = document.getElementById("asStep3SuccessAddExpenseBtn");
  const successAddIncome = document.getElementById("asStep3SuccessAddIncomeBtn");
  const successContinue = document.getElementById("asStep3ContinueBtn");
  const actionsShell = document.getElementById("accountSetupActions");
  const continueGateHint = document.getElementById("accountSetupContinueGateHint");
  const forecastReadyHint = document.getElementById("accountSetupStep3ForecastReady");
  if (!document.getElementById("accountSetupWizard")) return;

  const hideContinueGateHint = () => {
    if (continueGateHint) continueGateHint.hidden = true;
    if (forecastReadyHint) forecastReadyHint.hidden = true;
    if (signupBtn) signupBtn.removeAttribute("aria-describedby");
  };

  try {
  hideContinueGateHint();
  for (const el of [saveInc, cancelInc, saveExp, cancelExp]) {
    if (el) el.style.display = "none";
  }
  if (addMoreTxBtn) addMoreTxBtn.style.display = "none";
  // Default: hide skip. We'll selectively show it on Step 3 once a tx exists.
  if (accountSetupSkipBtn) accountSetupSkipBtn.style.display = "none";
  if (actionsShell) actionsShell.classList.remove("account-setup-actions--step3-success");

  // Step-aware narrative copy: "Step N of 4" label + a precise headline and subline.
  // We read the draft once for the title decision (form/after-save/intro) to keep
  // the headline in sync with what's already on screen.
  try {
    const draft = readAccountSetupDraftRaw() || {};
    const txs = Array.isArray(draft.transactions) ? draft.transactions : [];
    const copy = getAccountSetupStepCopy(s, {
      step3Phase: getAccountSetupStep3Phase(),
      step3After: isAccountSetupStep3AfterSave(),
      hasAnyTransaction: txs.length > 0,
    });
    if (stepLabel) stepLabel.textContent = `Step ${getAccountSetupDisplayStepNumber(s)} of 4`;
    if (eyebrow) eyebrow.textContent = copy.title;
    if (reassurance) reassurance.hidden = s !== 0;
    if (subEyebrow) {
      subEyebrow.textContent = copy.subtitle;
      subEyebrow.hidden = false;
    }
  } catch (_) {
    if (stepLabel) stepLabel.textContent = `Step ${getAccountSetupDisplayStepNumber(s)} of 4`;
    if (eyebrow) eyebrow.textContent = "Let’s build your forecast";
    if (reassurance) reassurance.hidden = s !== 0;
    if (subEyebrow) subEyebrow.hidden = false;
  }

  try {
    if (s === 2) syncAccountSetupStep3HubState();
  } catch (_) {}

  if (s < 2) {
    if (signupBtn) {
      signupBtn.style.display = "";
      signupBtn.textContent = "Next";
      // Ensure Next is always the primary (green) style.
      signupBtn.classList.remove("secondary");
      signupBtn.classList.add("top-nav__logout");
    }
    return;
  }

  if (s === 2) {
    const phase = getAccountSetupStep3Phase();
    if (phase === "form") {
      hideContinueGateHint();
      if (saveInc) saveInc.style.display = "inline-flex";
      if (cancelInc) cancelInc.style.display = "inline-flex";
      if (signupBtn) signupBtn.style.display = "none";
      if (saveInc) saveInc.textContent = "Next";
      if (cancelInc) cancelInc.textContent = "Cancel";
      if (addMoreTxBtn) addMoreTxBtn.style.display = "none";
      const msg = document.getElementById("accountSetupStep3Success");
      if (msg) msg.hidden = true;
      if (successAddExpense) successAddExpense.hidden = true;
      if (successAddIncome) successAddIncome.hidden = true;
      if (successContinue) successContinue.hidden = true;
    } else {
      if (signupBtn) {
        signupBtn.style.display = "";
        const { incomeCount, expenseCount, totalCount } = getAccountSetupTransactionCounts();
        const hasMinForForecast = incomeCount >= 1 && expenseCount >= 1;
        signupBtn.textContent = "Continue";
        signupBtn.classList.remove("secondary");
        signupBtn.classList.add("top-nav__logout");
        signupBtn.disabled = totalCount < 1;
        if (forecastReadyHint) forecastReadyHint.hidden = !hasMinForForecast;
        if (continueGateHint) {
          continueGateHint.hidden = totalCount >= 1;
        }
        signupBtn.removeAttribute("aria-describedby");
        if (totalCount < 1) {
          signupBtn.setAttribute("aria-describedby", "accountSetupContinueGateHint");
        } else if (hasMinForForecast) {
          signupBtn.setAttribute("aria-describedby", "accountSetupStep3ForecastReady");
        }
      }
      if (accountSetupSkipBtn) accountSetupSkipBtn.style.display = "none";
      if (hubAddIncome) hubAddIncome.disabled = false;
      if (hubAddExpense) hubAddExpense.disabled = false;
      if (successContinue) successContinue.hidden = true;
    }
    return;
  }

  if (s === 3) {
    const phase = getAccountSetupExpensePhase();
    if (phase === "form") {
      if (saveExp) saveExp.style.display = "inline-flex";
      if (cancelExp) cancelExp.style.display = "inline-flex";
      if (signupBtn) signupBtn.style.display = "none";
      const after = isAccountSetupExpenseAfterSave();
      if (saveExp) saveExp.textContent = after ? "Add Another Transaction" : "Next";
      if (cancelExp) cancelExp.textContent = after ? "Continue Setup" : "Cancel";
      const msg = document.getElementById("accountSetupStep4Success");
      if (msg) {
        const textEl = msg.querySelector(".account-setup-step3-form__successText");
        if (textEl) textEl.textContent = "✓ Your forecast is taking shape";
        msg.hidden = !after;
        if (after) {
          try { renderAccountSetupSuccessSummary("accountSetupStep4SuccessSummary"); } catch (_) {}
        }
      }
    } else if (signupBtn) {
      signupBtn.style.display = "none";
    }
    return;
  }

  if (s === 4) {
    if (signupBtn) {
      signupBtn.style.display = "";
      signupBtn.textContent = "See My Forecast";
      // Ensure primary styling in the final step as well.
      signupBtn.classList.remove("secondary");
      signupBtn.classList.add("top-nav__logout");
    }
  }
  } finally {
    syncAccountSetupBackButtonVisibility();
  }
}

function initAccountSetupCardAccordion() {
  if (!isAccountSetupPath()) return;
  if (document.getElementById("accountSetupWizard")) return;
  const wrap = document.getElementById("accountSetupCards");
  if (!wrap) return;
  if (wrap.dataset.asAccordionInit === "1") return;
  wrap.dataset.asAccordionInit = "1";

  const cards = [...wrap.querySelectorAll("section.account-setup-card[data-as-card]")];
  if (!cards.length) return;

  function setCollapsed(card, collapsed) {
    card.classList.toggle("is-collapsed", collapsed);
    const btn = card.querySelector("button.account-setup-card__toggle");
    if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  for (const card of cards) {
    const btn = card.querySelector("button.account-setup-card__toggle");
    if (!btn) continue;
    btn.addEventListener("click", () => {
      const isCollapsed = card.classList.contains("is-collapsed");
      if (isCollapsed) {
        // True accordion behavior: expanding one collapses the others.
        for (const other of cards) {
          setCollapsed(other, other !== card);
        }
      } else {
        // Allow collapsing the currently-open card.
        setCollapsed(card, true);
      }
    });
  }

  // Initialize aria-expanded from the current DOM state.
  for (const c of cards) {
    const btn = c.querySelector("button.account-setup-card__toggle");
    if (!btn) continue;
    const collapsed = c.classList.contains("is-collapsed");
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

function isAccountSetupPath() {
  try {
    return String(window.location.pathname || "").includes("account-setup");
  } catch (_) {
    return false;
  }
}

function isSignupPath() {
  try {
    return String(window.location.pathname || "").includes("/signup");
  } catch (_) {
    return false;
  }
}

function getAccountSetupWizardStep() {
  const w = document.getElementById("accountSetupWizard");
  if (!w) return 0;
  const n = parseInt(w.dataset.step || "0", 10);
  return Number.isFinite(n) ? Math.min(4, Math.max(0, n)) : 0;
}

function persistAccountSetupWizardMeta(stepIndex) {
  try {
    const prev = readAccountSetupDraftRaw();
    const raw = prev && typeof prev === "object" && !Array.isArray(prev) ? { ...prev } : {};
    raw.wizardStep = stepIndex;
    raw.wizardFlowVersion = ACCOUNT_SETUP_WIZARD_FLOW_VERSION;
    persistAccountSetupDraftObject(raw);
  } catch (_) {}
}

function setAccountSetupWizardStep(step, opts = {}) {
  const skipPersist = !!opts.skipPersist;
  const w = document.getElementById("accountSetupWizard");
  const track = document.getElementById("accountSetupWizardTrack");
  if (!w || !track) return;
  const s = Math.min(4, Math.max(0, step));
  w.dataset.step = String(s);
  const activePanelIndex = ACCOUNT_SETUP_PANEL_FOR_STEP[s];
  /* Show one panel at a time (avoid translateX(%): % is vs. track width and can misalign panels). */
  if (track.style.transform) track.style.removeProperty("transform");

  for (let i = 0; i < 5; i++) {
    const p = document.getElementById(`accountSetupWizardPanel${i}`);
    if (!p) continue;
    const active = i === activePanelIndex;
    p.classList.toggle("account-setup-wizard__panel--active", active);
    p.setAttribute("aria-hidden", active ? "false" : "true");
    if (active) p.removeAttribute("inert");
    else p.setAttribute("inert", "");
  }

  const displayStepNum = getAccountSetupDisplayStepNumber(s);
  const pct = (displayStepNum / 4) * 100;
  w.style.setProperty("--as-wizard-progress-pct", `${pct}%`);
  const prog = document.getElementById("accountSetupWizardProgress");
  if (prog) prog.setAttribute("aria-valuenow", String(displayStepNum));

  if (addMoreTxBtn) addMoreTxBtn.style.display = "none";
  syncAccountSetupWizardShellButtons();

  if (!skipPersist) persistAccountSetupWizardMeta(s);

  // Step 2: land on the editable account name so it feels obviously customizable.
  if (s === 1) {
    focusAccountSetupAccountNameInput();
  }

  if (s < 2 && document.getElementById("accountSetupWizardPanel2")) {
    const p2 = document.getElementById("accountSetupWizardPanel2");
    const intro = document.getElementById("accountSetupWizardStep3Intro");
    const form = document.getElementById("accountSetupWizardStep3Form");
    p2.setAttribute("data-step3-phase", "intro");
    if (intro) intro.hidden = false;
    if (form) form.hidden = true;
    const kt = document.getElementById("accountSetupKindToggle");
    if (kt) kt.classList.remove("account-setup-kind-toggle--income-only");
  }
  if (s < 3 && document.getElementById("accountSetupWizardPanel3")) {
    const p3 = document.getElementById("accountSetupWizardPanel3");
    const intro3 = document.getElementById("accountSetupWizardStep4Intro");
    const form3 = document.getElementById("accountSetupWizardStep4Form");
    p3.setAttribute("data-expense-phase", "intro");
    if (intro3) intro3.hidden = false;
    if (form3) form3.hidden = true;
    const kte = document.getElementById("accountSetupExpenseKindToggle");
    if (kte) kte.classList.remove("account-setup-kind-toggle--expense-only");
  }
}

function toMoneyNumber(raw) {
  const p = parseAccountSetupCushionRaw(raw);
  return p.ok && !p.empty ? p.num : null;
}

/** Display dollars in onboarding fields (comma grouping; decimals only when typed). */
function formatAccountSetupMoneyDisplay(raw, num) {
  const n = typeof num === "number" ? num : null;
  if (n == null || !Number.isFinite(n)) return "";
  const rawStr = String(raw ?? "").trim();
  const showDecimals = rawStr.includes(".") || Math.abs(n % 1) > 1e-9;
  if (showDecimals) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatAccountSetupMoneyField(el) {
  if (!el) return;
  const parsed = parseAccountSetupCushionRaw(el.value);
  if (!parsed.ok || parsed.empty) return;
  el.value = formatAccountSetupMoneyDisplay(el.value, parsed.num);
}

function bindAccountSetupMoneyField(el) {
  if (!el || el.dataset.bwMoneyBound === "1") return;
  el.dataset.bwMoneyBound = "1";
  el.addEventListener("blur", () => formatAccountSetupMoneyField(el));
  el.addEventListener("focus", () => {
    const parsed = parseAccountSetupCushionRaw(el.value);
    if (!parsed.ok || parsed.empty) return;
    const n = parsed.num;
    el.value = Math.abs(n % 1) > 1e-9 ? String(n) : String(Math.trunc(n));
  });
}

function initAccountSetupMoneyFields() {
  for (const id of [
    "accountStartingBalance",
    "accountSetupKeepInChecking",
    "asTxAmount",
    "asExpTxAmount",
  ]) {
    const el = document.getElementById(id);
    bindAccountSetupMoneyField(el);
    formatAccountSetupMoneyField(el);
  }
}

/** Default minimum balance saved on signup when the user does not enter their own. */
const DEFAULT_SIGNUP_MIN_BALANCE_THRESHOLD = 1000;

/** User-entered cushion amount, or the signup default when the field is blank. */
function resolveSignupMinBalanceThreshold(cushionP) {
  if (cushionP && cushionP.ok && !cushionP.empty && Number.isFinite(cushionP.num) && cushionP.num > 0) {
    return cushionP.num;
  }
  return DEFAULT_SIGNUP_MIN_BALANCE_THRESHOLD;
}

function resolveMinBalanceThresholdFromSignupDraft(draft) {
  const raw = draft?.account?.balance_threshold_min;
  if (raw !== undefined && raw !== null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_SIGNUP_MIN_BALANCE_THRESHOLD;
}

/** Same rules as app balance-threshold inputs: optional, allows $/commas. */
function parseAccountSetupCushionRaw(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: true, empty: true, num: null };
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return { ok: false };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, empty: false, num: n };
}

function accountSetupCheckingCushionRawFromDom() {
  return String(document.getElementById("accountSetupKeepInChecking")?.value ?? "").trim();
}

function getAccountSetupStep() {
  if (!isAccountSetupPath()) return "account";
  if (document.getElementById("accountSetupWizard")) {
    return getAccountSetupWizardStep() >= 2 ? "transactions" : "account";
  }
  if (!accountSetupTransactionsSectionEl) return "account";
  return accountSetupTransactionsSectionEl.hidden ? "account" : "transactions";
}

function setAccountSetupStep(step) {
  if (!isAccountSetupPath()) return;
  if (document.getElementById("accountSetupWizard")) {
    if (step === "transactions") setAccountSetupWizardStep(2);
    else setAccountSetupWizardStep(1);
    return;
  }
  if (!accountSetupAccountSectionEl || !accountSetupTransactionsSectionEl) return;
  const s = step === "transactions" ? "transactions" : "account";
  accountSetupAccountSectionEl.hidden = s !== "account";
  accountSetupTransactionsSectionEl.hidden = s !== "transactions";
  if (signupBtn) signupBtn.textContent = s === "account" ? "Next" : "Create Account";
  if (addMoreTxBtn) addMoreTxBtn.style.display = s === "transactions" ? "inline-flex" : "none";
}

function isoTodayLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureAccountStartingBalanceDateDefault() {
  if (!isAccountSetupPath()) return;
  const el = document.getElementById("accountStartingBalanceDate");
  if (!el) return;
  if (!String(el.value || "").trim()) el.value = isoTodayLocal();
}

function ensureAccountSetupDefaultAccountName() {
  if (!isAccountSetupPath()) return;
  const el = document.getElementById("accountName");
  if (!el) return;
  try {
    const raw = readAccountSetupDraftRaw();
    if (raw && raw.account && String(raw.account.name || "").trim()) return;
  } catch (_) {}
  if (!String(el.value || "").trim()) el.value = "Checking";
}

function focusAccountSetupAccountNameInput() {
  const el = document.getElementById("accountName");
  if (!el) return;
  window.setTimeout(() => {
    try {
      el.focus();
      if (String(el.value || "").trim()) el.select();
    } catch (_) {}
  }, 0);
}

function canAdvanceAccountSetupAccountStep({
  accountName,
  accountStartingBalanceRaw,
  accountStartingBalance,
  accountStartingBalanceDate,
  checkingCushionRaw = "",
}) {
  const cushionP = parseAccountSetupCushionRaw(String(checkingCushionRaw ?? ""));
  const anyAccount =
    !!accountName ||
    (accountStartingBalanceRaw != null && String(accountStartingBalanceRaw).trim() !== "") ||
    !!accountStartingBalanceDate;
  if (anyAccount) {
    if (!accountName)
      return {
        ok: false,
        message: "Account name is required (or leave the account section blank).",
        focusFieldId: "accountName",
      };
    if (accountStartingBalance == null)
      return {
        ok: false,
        message:
          "Enter today's available balance in Starting Balance (the first dollar field under Account name). The lower field is for your cushion only—not your current balance.",
        focusFieldId: "accountStartingBalance",
      };
    if (!accountStartingBalanceDate)
      return {
        ok: false,
        message: "Choose a Balance as of date (or leave the account section blank).",
        focusFieldId: "accountStartingBalanceDate",
      };
    if (!cushionP.ok) {
      return {
        ok: false,
        message: "Use a number for your comfortable minimum balance, or clear the field to use the $1,000 default.",
        focusFieldId: "accountSetupKeepInChecking",
      };
    }
  }
  const cushionThresholdMin = anyAccount ? resolveSignupMinBalanceThreshold(cushionP) : null;
  return { ok: true, anyAccount, cushionThresholdMin };
}

/** Applies account-step validation error banner and focuses the offending field when possible. */
function showAccountSetupAccountGateError(gate) {
  if (!gate || gate.ok) return false;
  setCallout(signupCalloutEl, gate.message, "error");
  const fid = gate.focusFieldId;
  if (fid && typeof fid === "string") {
    window.setTimeout(() => {
      try {
        const el = document.getElementById(fid);
        if (!el) return;
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el.focus({ preventScroll: true });
      } catch (_) {}
    }, 0);
  }
  return true;
}

function goToAccountSetup() {
  if (!signupBtn) return;
  setCallout(signupCalloutEl, "", "");
  const q = window.location.search || "";
  window.location.assign("/account-setup" + q);
}

function goToSignupFromAccountSetup() {
  if (!signupBtn) return;
  setCallout(signupCalloutEl, "", "");
  try {
    const existingDraft = readAccountSetupDraftRaw() || {};
    const existingTransactions = Array.isArray(existingDraft.transactions) ? existingDraft.transactions : [];

    const accountName = (document.getElementById("accountName")?.value || "").trim();
    const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
    const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
    const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
    const checkingCushionRaw = accountSetupCheckingCushionRawFromDom();
    const gate = canAdvanceAccountSetupAccountStep({
      accountName,
      accountStartingBalanceRaw,
      accountStartingBalance,
      accountStartingBalanceDate,
      checkingCushionRaw,
    });
    if (showAccountSetupAccountGateError(gate)) return;

    const parsedTx = readAccountSetupTransactionFromInputs();
    const anyTx = !parsedTx.empty;
    if (anyTx) {
      if (!parsedTx.ok) {
        setCallout(signupCalloutEl, parsedTx.message || "Please complete the transaction.", "error");
        return;
      }
    }
    persistAccountSetupDraftObject({
        ...existingDraft,
        ...(gate.anyAccount
          ? {
              account: {
                name: accountName,
                type: "checking",
                starting_balance: accountStartingBalance,
                starting_balance_date: accountStartingBalanceDate,
                balance_threshold_min: gate.cushionThresholdMin,
              },
            }
          : {}),
        ...(anyTx
          ? {
              transactions: [...existingTransactions, parsedTx.tx],
            }
          : { transactions: existingTransactions }),
        step: "transactions",
    });
  } catch (e) {
    setCallout(signupCalloutEl, (e && e.message) || "Could not continue.", "error");
    return;
  }
  const q = window.location.search || "";
  window.location.assign("/signup/" + q);
}

function readAccountSetupDraftRaw() {
  const raw = readAccountSetupDraftJsonFromStorage();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

const ACCOUNT_SETUP_REPEAT_RECURRENCES = new Set([
  "monthly",
  "twice_monthly",
  "biweekly",
  "weekly",
  "semiannual",
  "yearly",
  "quarterly",
]);

const ACCOUNT_SETUP_LONG_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const ACCOUNT_SETUP_MONTH_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
});
const ACCOUNT_SETUP_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

function normalizeAccountSetupRecurrenceSelection(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v || v === "once") return null;
  return ACCOUNT_SETUP_REPEAT_RECURRENCES.has(v) ? v : null;
}

function parseAccountSetupIsoDate(iso) {
  const raw = String(iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(5, 7));
  const d = Number(raw.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function formatAccountSetupOrdinalDay(n, opts = {}) {
  const day = Number(n);
  if (!Number.isFinite(day) || day < 1) return "";
  if (opts.useLastDayLabel && day === 31) return "last day";
  const mod100 = day % 100;
  const mod10 = day % 10;
  let suffix = "th";
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = "st";
    else if (mod10 === 2) suffix = "nd";
    else if (mod10 === 3) suffix = "rd";
  }
  return `${day}${suffix}`;
}

/** `yyyy-mm-dd` for `<input type="date">`; prefers the checking account starting-balance date when set. */
function accountSetupDefaultNextDateIso() {
  try {
    const bal = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(bal)) return bal;
  } catch (_) {}
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function revealAccountSetupFormError(message, focusElId) {
  setCallout(signupCalloutEl, message || "Please complete the transaction.", "error");
  try {
    signupCalloutEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (_) {}
  if (focusElId) {
    try {
      document.getElementById(focusElId)?.focus();
    } catch (_) {}
  }
}

function getAccountSetupScheduleFields(prefix) {
  if (prefix === "asExp") {
    return {
      recurrenceEl: document.getElementById("asExpRecurrence"),
      dateEl: document.getElementById("asExpTxDate"),
      secondDayWrap: document.getElementById("asExpSecondDayWrap"),
      secondDayEl: document.getElementById("asExpSecondDayOfMonth"),
      summaryEl: document.getElementById("asExpScheduleSummary"),
      endsRow: document.getElementById("asExpEndsRow"),
      endsModeEl: document.getElementById("asExpEndsMode"),
      endDateWrap: document.getElementById("asExpEndDateWrap"),
      endDateEl: document.getElementById("asExpEndDate"),
      endCountWrap: document.getElementById("asExpEndCountWrap"),
      endCountEl: document.getElementById("asExpEndCount"),
    };
  }
  return {
    recurrenceEl: document.getElementById("asTxRecurrence"),
    dateEl: document.getElementById("asTxDate"),
    secondDayWrap: document.getElementById("asTxSecondDayWrap"),
    secondDayEl: document.getElementById("asTxSecondDayOfMonth"),
    summaryEl: document.getElementById("asTxScheduleSummary"),
    endsRow: document.getElementById("asTxEndsRow"),
    endsModeEl: document.getElementById("asTxEndsMode"),
    endDateWrap: document.getElementById("asTxEndDateWrap"),
    endDateEl: document.getElementById("asTxEndDate"),
    endCountWrap: document.getElementById("asTxEndCountWrap"),
    endCountEl: document.getElementById("asTxEndCount"),
  };
}

function populateAccountSetupSecondDayOptions(selectEl) {
  if (!selectEl || selectEl.dataset.secondDayInit === "1") return;
  selectEl.dataset.secondDayInit = "1";
  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose second date";
  selectEl.appendChild(placeholder);
  for (let day = 1; day <= 31; day += 1) {
    const opt = document.createElement("option");
    opt.value = String(day);
    opt.textContent = day === 31 ? "Last day" : formatAccountSetupOrdinalDay(day);
    selectEl.appendChild(opt);
  }
}

function inferAccountSetupSecondDayValue(startIso) {
  const start = parseAccountSetupIsoDate(startIso);
  if (!start) return "";
  const day = start.getDate();
  if (day <= 15) return "31";
  return "15";
}

function accountSetupScheduleSummaryText(recurrence, startIso, secondDayValue) {
  if (!recurrence) return "";
  const start = parseAccountSetupIsoDate(startIso);
  if (!start) return "Pick a next date and we’ll set the schedule automatically.";
  if (recurrence === "weekly") {
    return `Repeats weekly on ${ACCOUNT_SETUP_WEEKDAY_FORMATTER.format(start)}.`;
  }
  if (recurrence === "biweekly") {
    return `Repeats every 2 weeks starting ${ACCOUNT_SETUP_LONG_DATE_FORMATTER.format(start)}.`;
  }
  if (recurrence === "twice_monthly") {
    const second = Number(secondDayValue);
    if (!Number.isFinite(second) || second < 1 || second > 31) {
      return `Next date sets the first monthly date (${formatAccountSetupOrdinalDay(start.getDate())}). Choose the second date.`;
    }
    return `Repeats twice monthly on the ${formatAccountSetupOrdinalDay(start.getDate())} and ${formatAccountSetupOrdinalDay(second, { useLastDayLabel: true })}.`;
  }
  if (recurrence === "monthly") {
    return `Repeats monthly on the ${formatAccountSetupOrdinalDay(start.getDate())}.`;
  }
  if (recurrence === "quarterly") {
    return `Repeats every 3 months on the ${formatAccountSetupOrdinalDay(start.getDate())}.`;
  }
  if (recurrence === "semiannual") {
    return `Repeats every 6 months on the ${formatAccountSetupOrdinalDay(start.getDate())}.`;
  }
  if (recurrence === "yearly") {
    return `Repeats every year on ${ACCOUNT_SETUP_MONTH_DAY_FORMATTER.format(start)}.`;
  }
  return "";
}

function refreshAccountSetupScheduleLayout() {
  syncAccountSetupScheduleUi("asTx");
  syncAccountSetupScheduleUi("asExp");
  try {
    requestAnimationFrame(() => {
      document.querySelectorAll(".account-setup-tx-schedule-block").forEach((el) => {
        void el.offsetHeight;
      });
    });
  } catch (_) {}
}

function syncAccountSetupScheduleUi(prefix) {
  const fields = getAccountSetupScheduleFields(prefix);
  if (fields.dateEl) {
    const cur = String(fields.dateEl.value || "").trim();
    if (!cur) fields.dateEl.value = accountSetupDefaultNextDateIso();
  }
  const recurrence = normalizeAccountSetupRecurrenceSelection(fields.recurrenceEl?.value || "");
  const repeats = !!recurrence;
  const startIso = String(fields.dateEl?.value || "").trim();
  if (fields.secondDayEl) populateAccountSetupSecondDayOptions(fields.secondDayEl);

  if (fields.secondDayWrap) fields.secondDayWrap.hidden = recurrence !== "twice_monthly";
  if (fields.secondDayEl) {
    const needsSuggestedDefault =
      recurrence === "twice_monthly" &&
      startIso &&
      (!String(fields.secondDayEl.value || "").trim() || Number(fields.secondDayEl.value) === Number(startIso.slice(8, 10)));
    if (needsSuggestedDefault) fields.secondDayEl.value = inferAccountSetupSecondDayValue(startIso);
    if (recurrence !== "twice_monthly") fields.secondDayEl.value = "";
    fields.secondDayEl.disabled = recurrence !== "twice_monthly";
  }

  if (fields.endsRow) fields.endsRow.hidden = !repeats;
  if (!repeats) {
    if (fields.endsModeEl) fields.endsModeEl.value = "never";
    if (fields.endDateWrap) fields.endDateWrap.hidden = true;
    if (fields.endCountWrap) fields.endCountWrap.hidden = true;
    if (fields.endDateEl) {
      fields.endDateEl.value = "";
      fields.endDateEl.disabled = true;
    }
    if (fields.endCountEl) {
      fields.endCountEl.value = "";
      fields.endCountEl.disabled = true;
    }
  } else {
    const endsMode = String(fields.endsModeEl?.value || "never").trim().toLowerCase();
    if (fields.endDateWrap) fields.endDateWrap.hidden = endsMode !== "on_date";
    if (fields.endCountWrap) fields.endCountWrap.hidden = endsMode !== "after_count";
    if (fields.endDateEl) {
      if (endsMode !== "on_date") fields.endDateEl.value = "";
      fields.endDateEl.disabled = endsMode !== "on_date";
    }
    if (fields.endCountEl) {
      if (endsMode !== "after_count") fields.endCountEl.value = "";
      fields.endCountEl.disabled = endsMode !== "after_count";
    }
  }

  if (fields.summaryEl) {
    const summary = accountSetupScheduleSummaryText(
      recurrence,
      startIso,
      String(fields.secondDayEl?.value || "").trim()
    );
    fields.summaryEl.textContent = summary;
    fields.summaryEl.hidden = !summary;
  }
}

function readAccountSetupScheduleFromInputs(prefix, startDateIso) {
  const fields = getAccountSetupScheduleFields(prefix);
  const recurrence = normalizeAccountSetupRecurrenceSelection(fields.recurrenceEl?.value || "");
  if (!recurrence) {
    return {
      recurring: false,
      recurrence: null,
      second_day_of_month: null,
      end_date: null,
      end_count: null,
      message: "",
    };
  }

  let secondDayOfMonth = null;
  if (recurrence === "twice_monthly") {
    const raw = String(fields.secondDayEl?.value || "").trim();
    const n = raw ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 1 || n > 31) {
      return {
        recurring: false,
        recurrence: null,
        second_day_of_month: null,
        end_date: null,
        end_count: null,
        message: "Choose the second monthly date.",
      };
    }
    const startDay = /^\d{4}-\d{2}-\d{2}$/.test(String(startDateIso || "")) ? Number(String(startDateIso).slice(8, 10)) : NaN;
    if (Number.isFinite(startDay) && n === startDay) {
      return {
        recurring: false,
        recurrence: null,
        second_day_of_month: null,
        end_date: null,
        end_count: null,
        message: "The second monthly date must differ from the next date.",
      };
    }
    secondDayOfMonth = n;
  }

  const endsMode = String(fields.endsModeEl?.value || "never").trim().toLowerCase();
  let endDate = null;
  let endCount = null;
  if (endsMode === "on_date") {
    endDate = String(fields.endDateEl?.value || "").trim() || null;
    if (!endDate) {
      return {
        recurring: false,
        recurrence: null,
        second_day_of_month: null,
        end_date: null,
        end_count: null,
        message: "Choose when this repeating item ends.",
      };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return {
        recurring: false,
        recurrence: null,
        second_day_of_month: null,
        end_date: null,
        end_count: null,
        message: "Ends on must be a date",
      };
    }
    if (startDateIso && endDate < startDateIso) {
      return {
        recurring: false,
        recurrence: null,
        second_day_of_month: null,
        end_date: null,
        end_count: null,
        message: "Ends on cannot be before the start date",
      };
    }
  } else if (endsMode === "after_count") {
    const raw = String(fields.endCountEl?.value || "").trim();
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) {
      return {
        recurring: false,
        recurrence: null,
        second_day_of_month: null,
        end_date: null,
        end_count: null,
        message: "Ends after must be a whole number ≥ 1",
      };
    }
    endCount = n;
  }

  return {
    recurring: true,
    recurrence,
    second_day_of_month: secondDayOfMonth,
    end_date: endDate,
    end_count: endCount,
    message: "",
  };
}

function readAccountSetupTransactionFromInputs() {
  const txKind = String(document.querySelector('input[name="asTxKind"]:checked')?.value || "").trim();
  const txAmountRaw = document.getElementById("asTxAmount")?.value || "";
  const txAmount = toMoneyNumber(txAmountRaw);
  const txCategory = (document.getElementById("asTxCategory")?.value || "").trim();
  const txDate = String(document.getElementById("asTxDate")?.value || "").trim();
  const txNotes = (document.getElementById("asTxNotes")?.value || "").trim();
  const txVariable = !!document.getElementById("asTxVariable")?.checked;
  const recurrence = normalizeAccountSetupRecurrenceSelection(document.getElementById("asTxRecurrence")?.value || "");
  const repeats = !!recurrence;
  const txBgColor = String(document.getElementById("asTxBgColor")?.value || "").trim();
  const anyTx =
    (txAmountRaw != null && String(txAmountRaw).trim() !== "") ||
    !!txCategory ||
    !!txDate ||
    !!txNotes ||
    repeats ||
    !!txBgColor;
  if (!anyTx) return { ok: false, empty: true, tx: null, message: "" };
  if (!txKind) return { ok: false, empty: false, tx: null, message: "Transaction type is required." };
  if (txAmount == null || txAmount <= 0) return { ok: false, empty: false, tx: null, message: "Transaction amount is required." };
  if (!txDate) return { ok: false, empty: false, tx: null, message: "Next date is required — choose the first day this should occur." };
  const categoryResolved = txCategory || "Uncategorized";
  const schedule = readAccountSetupScheduleFromInputs("asTx", txDate);
  if (repeats && schedule.message) return { ok: false, empty: false, tx: null, message: schedule.message };
  return {
    ok: true,
    empty: false,
    tx: {
      kind: txKind,
      amount: txAmount,
      category: categoryResolved,
      date: txDate,
      notes: txNotes,
      variable: repeats ? txVariable : false,
      recurring: schedule.recurring,
      recurrence: schedule.recurrence,
      second_day_of_month: schedule.second_day_of_month,
      end_date: schedule.end_date,
      end_count: schedule.end_count,
      bg_color: txBgColor || null,
    },
    message: "",
  };
}

function setAccountSetupKindRadioValue(groupName, value) {
  const radio = document.querySelector(`input[name="${groupName}"][value="${value}"]`);
  if (!radio) return null;
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
  return radio;
}

/** @param {"income"|"expense"|void} forKind When set (e.g. hub buttons), form resets to that type; otherwise the current type is preserved when possible. */
function resetAccountSetupTransactionForm(forKind) {
  setAccountSetupStep3AfterSave(false);
  const preservedKind =
    forKind === "income" || forKind === "expense"
      ? forKind
      : String(document.querySelector('input[name="asTxKind"]:checked')?.value || "").trim();
  const amountEl = document.getElementById("asTxAmount");
  const dateEl = document.getElementById("asTxDate");
  const notesEl = document.getElementById("asTxNotes");
  const varEl = document.getElementById("asTxVariable");
  const recSel = document.getElementById("asTxRecurrence");
  const endsModeEl = document.getElementById("asTxEndsMode");
  const secondDayEl = document.getElementById("asTxSecondDayOfMonth");
  const endCountEl = document.getElementById("asTxEndCount");
  const endDateEl = document.getElementById("asTxEndDate");
  const bgEl = document.getElementById("asTxBgColor");
  if (amountEl) amountEl.value = "";
  clearAccountSetupCategoryCombobox("asTxCategory");
  if (notesEl) notesEl.value = "";
  if (varEl) varEl.checked = false;
  if (recSel) recSel.value = "once";
  if (endsModeEl) endsModeEl.value = "never";
  if (secondDayEl) secondDayEl.value = "";
  if (endCountEl) endCountEl.value = "";
  if (endDateEl) endDateEl.value = "";
  if (bgEl) bgEl.value = "";
  const swatches = document.getElementById("asTxColorSwatches");
  if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
  let resolved =
    preservedKind === "income" || preservedKind === "expense"
      ? preservedKind
      : (() => {
          const formEl = document.getElementById("accountSetupWizardStep3Form");
          const incomeOnly = formEl && !formEl.hidden;
          return incomeOnly ? "income" : "expense";
        })();
  setAccountSetupKindRadioValue("asTxKind", resolved);
  syncAccountSetupScheduleUi("asTx");
}

function addMoreTransactionsFromAccountSetup() {
  if (!isAccountSetupPath()) return;
  setCallout(signupCalloutEl, "", "");
  const rawDraft = readAccountSetupDraftRaw() || {};
  const accountName = (document.getElementById("accountName")?.value || "").trim();
  const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
  const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
  const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();

  const gate = canAdvanceAccountSetupAccountStep({
    accountName,
    accountStartingBalanceRaw,
    accountStartingBalance,
    accountStartingBalanceDate,
    checkingCushionRaw: accountSetupCheckingCushionRawFromDom(),
  });
  if (showAccountSetupAccountGateError(gate)) {
    setAccountSetupStep("account");
    return;
  }

  const parsed = readAccountSetupTransactionFromInputs();
  if (!parsed.ok) {
    if (!parsed.empty) {
      const msg = parsed.message || "Please complete the transaction.";
      revealAccountSetupFormError(msg, /date|first day/i.test(msg) ? "asTxDate" : null);
    }
    return;
  }

  const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
  persistAccountSetupDraftObject({
      ...rawDraft,
      wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
      wizardStep: 2,
      step3Phase: "form",
      ...(gate.anyAccount
        ? {
            account: {
              name: accountName,
              type: "checking",
              starting_balance: accountStartingBalance,
              starting_balance_date: accountStartingBalanceDate,
              balance_threshold_min: gate.cushionThresholdMin,
            },
          }
        : {}),
      transactions: [...existing, parsed.tx],
      step: "transactions",
  });

  resetAccountSetupTransactionForm();
}

function accountSetupCancelIncomeClick() {
  if (!isAccountSetupPath()) return;
  if (isAccountSetupStep3AfterSave()) {
    setCallout(signupCalloutEl, "", "");
    // Continue setup: advance to the survey (primary goal) step.
    try {
      const rawDraft = readAccountSetupDraftRaw() || {};
      persistAccountSetupDraftObject({
          ...rawDraft,
          wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
          wizardStep: 4,
          step3Phase: "form",
          expensePhase: "intro",
        });

    } catch (_) {}
    lockAccountSetupWizardStepTransition();
    setAccountSetupWizardStep(4, { skipPersist: true });
    document.querySelector("[data-as-survey-opt]")?.focus();
    return;
  }
  setCallout(signupCalloutEl, "", "");
  setAccountSetupStep3Phase("intro");
  resetAccountSetupTransactionForm();
  document.getElementById("asTxHubAddIncomeBtn")?.focus();
}

async function accountSetupSaveIncomeClick() {
  if (!isAccountSetupPath()) return;
  if (isAccountSetupStep3AfterSave()) {
    // Add another transaction: clear the form but keep it open.
    setCallout(signupCalloutEl, "", "");
    setAccountSetupStep3AfterSave(false);
    resetAccountSetupTransactionForm();
    setAccountSetupStep3Phase("form");
    document.getElementById("asTxAmount")?.focus();
    return;
  }
  setCallout(signupCalloutEl, "", "");
  const rawDraft = readAccountSetupDraftRaw() || {};
  const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
  const accountName = (document.getElementById("accountName")?.value || "").trim();
  const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
  const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
  const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
  const gate = canAdvanceAccountSetupAccountStep({
    accountName,
    accountStartingBalanceRaw,
    accountStartingBalance,
    accountStartingBalanceDate,
    checkingCushionRaw: accountSetupCheckingCushionRawFromDom(),
  });
  if (showAccountSetupAccountGateError(gate)) {
    setAccountSetupWizardStep(1);
    return;
  }
  const parsed = readAccountSetupTransactionFromInputs();
  if (!parsed.ok) {
    const msg = parsed.message || "Please complete the transaction.";
    revealAccountSetupFormError(msg, /date|first day/i.test(msg) ? "asTxDate" : null);
    return;
  }
  const txs = [...existing, parsed.tx];
  try {
    persistAccountSetupDraftObject({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "intro",
        ...(gate.anyAccount
          ? {
              account: {
                name: accountName,
                type: "checking",
                starting_balance: accountStartingBalance,
                starting_balance_date: accountStartingBalanceDate,
                balance_threshold_min: gate.cushionThresholdMin,
              },
            }
          : {}),
        transactions: txs,
      });

  } catch (_) {}
  // Return to the stable Step 3 hub with updated progress state.
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupStep3AfterSave(false);
  setAccountSetupStep3Phase("intro");
  setCallout(signupCalloutEl, "", "");
  getAccountSetupStep3HubFocusTarget()?.focus();
}

function advanceAccountSetupWizardToExpenseForm() {
  const rawDraft = readAccountSetupDraftRaw() || {};
  try {
    persistAccountSetupDraftObject({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 3,
        expensePhase: "form",
      });

  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(3, { skipPersist: true });
  setAccountSetupExpensePhase("form");
  const ex = document.querySelector('input[name="asExpTxKind"][value="expense"]');
  if (ex) ex.checked = true;
  document.getElementById("asExpTxAmount")?.focus();
}

function advanceAccountSetupWizardToIncomeFormFromSuccess() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  setCallout(signupCalloutEl, "", "");
  try {
    const rawDraft = readAccountSetupDraftRaw() || {};
    persistAccountSetupDraftObject({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "form",
      });

  } catch (_) {}
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupStep3AfterSave(false);
  setAccountSetupStep3Phase("form");
  resetAccountSetupTransactionForm("income");
  document.getElementById("asTxAmount")?.focus();
}

function accountSetupTxHubAddIncomeClick() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  if (getAccountSetupWizardStep() !== 2 || getAccountSetupStep3Phase() !== "intro") return;
  setCallout(signupCalloutEl, "", "");
  try {
    const rawDraft = readAccountSetupDraftRaw() || {};
    persistAccountSetupDraftObject({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "form",
      });

  } catch (_) {}
  setAccountSetupStep3Phase("form");
  resetAccountSetupTransactionForm("income");
  document.getElementById("asTxAmount")?.focus();
}

function accountSetupTxHubAddExpenseClick() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  if (getAccountSetupWizardStep() !== 2 || getAccountSetupStep3Phase() !== "intro") return;
  setCallout(signupCalloutEl, "", "");
  try {
    const rawDraft = readAccountSetupDraftRaw() || {};
    persistAccountSetupDraftObject({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "form",
        expensePhase: "intro",
      });

  } catch (_) {}
  setAccountSetupStep3Phase("form");
  resetAccountSetupTransactionForm("expense");
  document.getElementById("asTxAmount")?.focus();
}

function accountSetupTxHubContinueClick() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  if (getAccountSetupWizardStep() !== 2 || getAccountSetupStep3Phase() !== "intro") return;
  if (getAccountSetupTransactionCounts().totalCount < 1) return;
  setCallout(signupCalloutEl, "", "");
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(4, { skipPersist: true });
  document.querySelector("[data-as-survey-opt]")?.focus();
}

function readAccountSetupExpenseTransactionFromInputs() {
  const txKind = String(document.querySelector('input[name="asExpTxKind"]:checked')?.value || "").trim();
  const txAmountRaw = document.getElementById("asExpTxAmount")?.value || "";
  const txAmount = toMoneyNumber(txAmountRaw);
  const txCategory = (document.getElementById("asExpTxCategory")?.value || "").trim();
  const txDate = String(document.getElementById("asExpTxDate")?.value || "").trim();
  const txNotes = (document.getElementById("asExpTxNotes")?.value || "").trim();
  const txVariable = !!document.getElementById("asExpVariable")?.checked;
  const recurrence = normalizeAccountSetupRecurrenceSelection(document.getElementById("asExpRecurrence")?.value || "");
  const repeats = !!recurrence;
  const txBgColor = String(document.getElementById("asExpTxBgColor")?.value || "").trim();
  const anyTx =
    (txAmountRaw != null && String(txAmountRaw).trim() !== "") ||
    !!txCategory ||
    !!txDate ||
    !!txNotes ||
    repeats ||
    !!txBgColor;
  if (!anyTx) return { ok: false, empty: true, tx: null, message: "" };
  if (!txKind) return { ok: false, empty: false, tx: null, message: "Transaction type is required." };
  if (txAmount == null || txAmount <= 0) return { ok: false, empty: false, tx: null, message: "Transaction amount is required." };
  if (!txDate) return { ok: false, empty: false, tx: null, message: "Next date is required — choose the first day this should occur." };
  const categoryResolved = txCategory || "Uncategorized";
  const schedule = readAccountSetupScheduleFromInputs("asExp", txDate);
  if (repeats && schedule.message) return { ok: false, empty: false, tx: null, message: schedule.message };
  return {
    ok: true,
    empty: false,
    tx: {
      kind: txKind,
      amount: txAmount,
      category: categoryResolved,
      date: txDate,
      notes: txNotes,
      variable: repeats ? txVariable : false,
      recurring: schedule.recurring,
      recurrence: schedule.recurrence,
      second_day_of_month: schedule.second_day_of_month,
      end_date: schedule.end_date,
      end_count: schedule.end_count,
      bg_color: txBgColor || null,
    },
    message: "",
  };
}

function resetAccountSetupExpenseForm() {
  setAccountSetupExpenseAfterSave(false);
  const amountEl = document.getElementById("asExpTxAmount");
  const dateEl = document.getElementById("asExpTxDate");
  const notesEl = document.getElementById("asExpTxNotes");
  const varEl = document.getElementById("asExpVariable");
  const recSel = document.getElementById("asExpRecurrence");
  const endsModeEl = document.getElementById("asExpEndsMode");
  const secondDayEl = document.getElementById("asExpSecondDayOfMonth");
  const endCountEl = document.getElementById("asExpEndCount");
  const endDateEl = document.getElementById("asExpEndDate");
  const bgEl = document.getElementById("asExpTxBgColor");
  if (amountEl) amountEl.value = "";
  clearAccountSetupCategoryCombobox("asExpTxCategory");
  if (notesEl) notesEl.value = "";
  if (varEl) varEl.checked = false;
  if (recSel) recSel.value = "once";
  if (endsModeEl) endsModeEl.value = "never";
  if (secondDayEl) secondDayEl.value = "";
  if (endCountEl) endCountEl.value = "";
  if (endDateEl) endDateEl.value = "";
  if (bgEl) bgEl.value = "";
  const swatches = document.getElementById("asExpTxColorSwatches");
  if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
  setAccountSetupKindRadioValue("asExpTxKind", "expense");
  syncAccountSetupScheduleUi("asExp");
}

function addMoreExpensesFromAccountSetup() {
  if (!isAccountSetupPath()) return;
  setCallout(signupCalloutEl, "", "");
  const rawDraft = readAccountSetupDraftRaw() || {};
  const accountName = (document.getElementById("accountName")?.value || "").trim();
  const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
  const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
  const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
  const gate = canAdvanceAccountSetupAccountStep({
    accountName,
    accountStartingBalanceRaw,
    accountStartingBalance,
    accountStartingBalanceDate,
    checkingCushionRaw: accountSetupCheckingCushionRawFromDom(),
  });
  if (showAccountSetupAccountGateError(gate)) {
    setAccountSetupWizardStep(1);
    return;
  }
  const parsed = readAccountSetupExpenseTransactionFromInputs();
  if (!parsed.ok) {
    if (!parsed.empty) {
      const msg = parsed.message || "Please complete the transaction.";
      revealAccountSetupFormError(msg, /date|first day/i.test(msg) ? "asExpTxDate" : null);
    }
    return;
  }
  const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
  persistAccountSetupDraftObject({
      ...rawDraft,
      wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
      wizardStep: 3,
      expensePhase: "form",
      ...(gate.anyAccount
        ? {
            account: {
              name: accountName,
              type: "checking",
              starting_balance: accountStartingBalance,
              starting_balance_date: accountStartingBalanceDate,
              balance_threshold_min: gate.cushionThresholdMin,
            },
          }
        : {}),
      transactions: [...existing, parsed.tx],
      step: "transactions",
  });
  resetAccountSetupExpenseForm();
}

function accountSetupCancelExpenseClick() {
  if (!isAccountSetupPath()) return;
  if (isAccountSetupExpenseAfterSave()) {
    setCallout(signupCalloutEl, "", "");
    setAccountSetupExpenseAfterSave(false);
    resetAccountSetupExpenseForm();
    try {
      const rawDraft = readAccountSetupDraftRaw() || {};
      persistAccountSetupDraftObject({
          ...rawDraft,
          wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
          wizardStep: 2,
          step3Phase: "intro",
          expensePhase: "intro",
        });

    } catch (_) {}
    lockAccountSetupWizardStepTransition();
    setAccountSetupWizardStep(2, { skipPersist: true });
    setAccountSetupExpensePhase("intro");
    setAccountSetupStep3Phase("intro");
    document.getElementById("asTxHubAddIncomeBtn")?.focus();
    return;
  }
  setCallout(signupCalloutEl, "", "");
  resetAccountSetupExpenseForm();
  try {
    const rawDraft = readAccountSetupDraftRaw() || {};
    persistAccountSetupDraftObject({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "intro",
        expensePhase: "intro",
      });

  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupExpensePhase("intro");
  setAccountSetupStep3Phase("intro");
  document.getElementById("asTxHubAddIncomeBtn")?.focus();
}

async function accountSetupSaveExpenseClick() {
  if (!isAccountSetupPath()) return;
  if (isAccountSetupExpenseAfterSave()) {
    setCallout(signupCalloutEl, "", "");
    setAccountSetupExpenseAfterSave(false);
    resetAccountSetupExpenseForm();
    setAccountSetupExpensePhase("form");
    document.getElementById("asExpTxAmount")?.focus();
    return;
  }
  setCallout(signupCalloutEl, "", "");
  const rawDraft = readAccountSetupDraftRaw() || {};
  const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
  const accountName = (document.getElementById("accountName")?.value || "").trim();
  const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
  const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
  const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
  const gate = canAdvanceAccountSetupAccountStep({
    accountName,
    accountStartingBalanceRaw,
    accountStartingBalance,
    accountStartingBalanceDate,
    checkingCushionRaw: accountSetupCheckingCushionRawFromDom(),
  });
  if (showAccountSetupAccountGateError(gate)) {
    setAccountSetupWizardStep(1);
    return;
  }
  const parsed = readAccountSetupExpenseTransactionFromInputs();
  if (!parsed.ok) {
    const msg = parsed.message || "Please complete the transaction.";
    revealAccountSetupFormError(msg, /date|first day/i.test(msg) ? "asExpTxDate" : null);
    return;
  }
  const txs = [...existing, parsed.tx];
  try {
    persistAccountSetupDraftObject({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "intro",
        expensePhase: "intro",
        ...(gate.anyAccount
          ? {
              account: {
                name: accountName,
                type: "checking",
                starting_balance: accountStartingBalance,
                starting_balance_date: accountStartingBalanceDate,
                balance_threshold_min: gate.cushionThresholdMin,
              },
            }
          : {}),
        transactions: txs,
      });

  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  // Return to the stable Step 3 hub with updated progress state.
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupStep3AfterSave(false);
  setAccountSetupStep3Phase("intro");
  setCallout(signupCalloutEl, "", "");
  getAccountSetupStep3HubFocusTarget()?.focus();
}

function hydrateAccountSetupSurveyFromDraft(o) {
  if (!o || typeof o !== "object") return;
  const wrap = document.getElementById("accountSetupWizardPanel4");
  if (!wrap) return;
  let opts = o.surveyHelpWith;
  if (opts == null) return;
  if (typeof opts === "string") opts = [opts];
  if (!Array.isArray(opts) || !opts.length) return;
  const buttons = [...wrap.querySelectorAll("[data-as-survey-opt]")];
  for (const b of buttons) {
    const k = String(b.getAttribute("data-as-survey-opt") || "");
    const on = !!k && opts.includes(k);
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const hasOther = opts.includes("other");
  const otherWrap = document.getElementById("accountSetupSurveyOtherWrap");
  const otherInput = document.getElementById("accountSetupSurveyOther");
  if (otherWrap) otherWrap.hidden = !hasOther;
  if (otherInput && o.surveyOther != null) otherInput.value = String(o.surveyOther);
}

function hydrateAccountSetupDraft() {
  if (!isAccountSetupPath()) return;
  const merged = readAccountSetupDraftRaw();
  if (!merged) return;
  try {
    persistAccountSetupDraftObject(merged);
  } catch (_) {}
  const raw = readAccountSetupDraftJsonFromStorage();
  if (!raw) return;
  try {
    const o = JSON.parse(raw);
    const tzEl = document.getElementById("timeZone");
    const accNameEl = document.getElementById("accountName");
    const accBalEl = document.getElementById("accountStartingBalance");
    const accDateEl = document.getElementById("accountStartingBalanceDate");
    const accCushionEl = document.getElementById("accountSetupKeepInChecking");
    const txAmountEl = document.getElementById("asTxAmount");
    const txCategoryEl = document.getElementById("asTxCategory");
    const txDateEl = document.getElementById("asTxDate");
    const txNotesEl = document.getElementById("asTxNotes");
    const txRecSelEl = document.getElementById("asTxRecurrence");
    const txEndDateEl = document.getElementById("asTxEndDate");
    const txEndCountEl = document.getElementById("asTxEndCount");
    const txEndDateWrapEl = document.getElementById("asTxEndDateWrap");
    const txEndCountWrapEl = document.getElementById("asTxEndCountWrap");
    const txBgColorEl = document.getElementById("asTxBgColor");
    if (tzEl && o.timeZone) tzEl.value = String(o.timeZone);
    if (o.account) {
      if (accNameEl && o.account.name) accNameEl.value = String(o.account.name);
      if (accBalEl && o.account.starting_balance != null) {
        accBalEl.value = formatAccountSetupMoneyDisplay("", Number(o.account.starting_balance));
      }
      if (accDateEl && o.account.starting_balance_date) accDateEl.value = String(o.account.starting_balance_date);
      if (accCushionEl && o.account && Object.prototype.hasOwnProperty.call(o.account, "balance_threshold_min")) {
        const m = o.account.balance_threshold_min;
        accCushionEl.value =
          m != null && m !== "" && Number.isFinite(Number(m))
            ? formatAccountSetupMoneyDisplay("", Number(m))
            : "";
      }
    }
    const lastTx = Array.isArray(o.transactions) && o.transactions.length ? o.transactions[o.transactions.length - 1] : o.transaction;
    if (lastTx) {
      const k = String(lastTx.kind || "").trim().toLowerCase();
      if (k === "expense") {
        const kindElE = document.querySelector(`input[name="asExpTxKind"][value="expense"]`);
        if (kindElE) kindElE.checked = true;
        const eAmt = document.getElementById("asExpTxAmount");
        const eCat = document.getElementById("asExpTxCategory");
        const eDate = document.getElementById("asExpTxDate");
        const eNotes = document.getElementById("asExpTxNotes");
        const eRecSel = document.getElementById("asExpRecurrence");
        const eSecondDay = document.getElementById("asExpSecondDayOfMonth");
        const eEndsMode = document.getElementById("asExpEndsMode");
        const eEndDate = document.getElementById("asExpEndDate");
        const eEndCount = document.getElementById("asExpEndCount");
        const eBg = document.getElementById("asExpTxBgColor");
        if (eAmt && lastTx.amount != null) {
          eAmt.value = formatAccountSetupMoneyDisplay("", Number(lastTx.amount));
        }
        if (eCat && lastTx.category) {
          const c = String(lastTx.category).trim();
          eCat.value = c === "Uncategorized" ? "" : c;
          bindAccountSetupCategoryKindFromTxn(eCat, c === "Uncategorized" ? "" : c, lastTx.kind);
          accountSetupSyncCategorySearchDisplay("asExpTxCategory");
        }
        if (eDate && lastTx.date) eDate.value = String(lastTx.date);
        if (eNotes && lastTx.notes) eNotes.value = String(lastTx.notes);
        const eRecurring = !!lastTx.recurring && !!lastTx.recurrence;
        const eHydratedRecurrence =
          String(lastTx.recurrence || "") === "bimonthly" ? "twice_monthly" : String(lastTx.recurrence || "");
        if (eRecSel) eRecSel.value = eRecurring ? eHydratedRecurrence : "once";
        if (eSecondDay && lastTx.second_day_of_month != null) eSecondDay.value = String(lastTx.second_day_of_month);
        if (eEndsMode) eEndsMode.value = lastTx.end_date ? "on_date" : lastTx.end_count != null ? "after_count" : "never";
        if (eEndDate && lastTx.end_date) eEndDate.value = String(lastTx.end_date);
        if (eEndCount && lastTx.end_count != null) eEndCount.value = String(lastTx.end_count);
        if (eBg && lastTx.bg_color) eBg.value = String(lastTx.bg_color);
        syncAccountSetupScheduleUi("asExp");
      } else {
        const kindEl = k ? document.querySelector(`input[name="asTxKind"][value="${k}"]`) : null;
        if (kindEl) kindEl.checked = true;
        if (txAmountEl && lastTx.amount != null) {
          txAmountEl.value = formatAccountSetupMoneyDisplay("", Number(lastTx.amount));
        }
        if (txCategoryEl && lastTx.category) {
          const c = String(lastTx.category).trim();
          txCategoryEl.value = c === "Uncategorized" ? "" : c;
          bindAccountSetupCategoryKindFromTxn(txCategoryEl, c === "Uncategorized" ? "" : c, lastTx.kind);
          accountSetupSyncCategorySearchDisplay("asTxCategory");
        }
        if (txDateEl && lastTx.date) txDateEl.value = String(lastTx.date);
        if (txNotesEl && lastTx.notes) txNotesEl.value = String(lastTx.notes);
        const txSecondDayEl = document.getElementById("asTxSecondDayOfMonth");
        const txEndsModeEl = document.getElementById("asTxEndsMode");
        const on = !!lastTx.recurring && !!lastTx.recurrence;
        const hydratedRecurrence =
          String(lastTx.recurrence || "") === "bimonthly" ? "twice_monthly" : String(lastTx.recurrence || "");
        if (txRecSelEl) txRecSelEl.value = on ? hydratedRecurrence : "once";
        if (txSecondDayEl && lastTx.second_day_of_month != null) txSecondDayEl.value = String(lastTx.second_day_of_month);
        if (txEndsModeEl) txEndsModeEl.value = lastTx.end_date ? "on_date" : lastTx.end_count != null ? "after_count" : "never";
        if (txEndDateEl && lastTx.end_date) txEndDateEl.value = String(lastTx.end_date);
        if (txEndCountEl && lastTx.end_count != null) txEndCountEl.value = String(lastTx.end_count);
        if (txBgColorEl && lastTx.bg_color) txBgColorEl.value = String(lastTx.bg_color);
        syncAccountSetupScheduleUi("asTx");
      }
    }
    if (document.getElementById("accountSetupWizard")) {
      let target = normalizePersistedAccountSetupWizardStep(o);
      const wsRaw = o.wizardStep;
      if (
        (!Number.isFinite(Number(wsRaw)) || wsRaw === "" || wsRaw === undefined || wsRaw === null) &&
        Number(o.wizardFlowVersion) !== ACCOUNT_SETUP_WIZARD_FLOW_VERSION
      ) {
        if (o.step === "transactions" || (Array.isArray(o.transactions) && o.transactions.length)) target = 2;
        else if (o.account && o.account.name) target = 1;
      }
      setAccountSetupWizardStep(target, { skipPersist: true });
      if (target === 4) hydrateAccountSetupSurveyFromDraft(o);
      if (target === 2 && document.getElementById("accountSetupWizardPanel2")) {
        const wantForm = String(o.step3Phase || "") === "form";
        if (wantForm) setAccountSetupStep3Phase("form");
        else syncAccountSetupWizardShellButtons();
      }
      if (target === 3 && document.getElementById("accountSetupWizardPanel3")) {
        const wantExpenseForm = String(o.expensePhase || "") === "form";
        if (wantExpenseForm) setAccountSetupExpensePhase("form");
        else syncAccountSetupWizardShellButtons();
      }
      return;
    }
    const step = String(o.step || "").trim().toLowerCase();
    if (step === "transactions") setAccountSetupStep("transactions");
  } catch (_) {}
}

function showSignupPlanBanner() {
  if (signupBannerHead) signupBannerHead.hidden = false;
}

function setBusy(isBusy) {
  if (!signupBtn) return;
  signupBtn.disabled = isBusy;
  for (const id of [
    "asTxSaveIncomeBtn",
    "asTxCancelIncomeBtn",
    "asExpSaveBtn",
    "asExpCancelBtn",
    "asTxHubAddIncomeBtn",
    "asTxHubAddExpenseBtn",
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = isBusy;
  }
  if (isAccountSetupPath()) {
    if (!isBusy) syncAccountSetupWizardShellButtons();
    return;
  }
  signupBtn.textContent = isBusy ? "Creating..." : "Create Account";
}

function readAccountSetupDraft() {
  const raw = readAccountSetupDraftJsonFromStorage();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const rawAcc =
      o && o.account && o.account.name && o.account.starting_balance_date != null ? o.account : null;
    const account = rawAcc
      ? {
          name: String(rawAcc.name),
          type: String(rawAcc.type || "checking"),
          starting_balance: Number(rawAcc.starting_balance ?? 0),
          starting_balance_date: String(rawAcc.starting_balance_date),
          ...(Object.prototype.hasOwnProperty.call(rawAcc, "balance_threshold_min")
            ? {
                balance_threshold_min:
                  rawAcc.balance_threshold_min == null || rawAcc.balance_threshold_min === ""
                    ? null
                    : Number(rawAcc.balance_threshold_min),
              }
            : {}),
        }
      : null;
    const txListRaw = Array.isArray(o?.transactions) ? o.transactions : o?.transaction ? [o.transaction] : [];
    const transactions = txListRaw
      .map((t) => ({
        kind: String(t?.kind || ""),
        amount: Number(t?.amount),
        category: String(t?.category || ""),
        date: String(t?.date || ""),
        notes: t?.notes != null ? String(t.notes) : "",
        variable: !!t?.variable,
        recurring: !!t?.recurring,
        recurrence: t?.recurrence != null && String(t.recurrence).trim() !== "" ? String(t.recurrence) : null,
        second_day_of_month:
          t?.second_day_of_month != null && Number.isFinite(Number(t.second_day_of_month))
            ? Number(t.second_day_of_month)
            : null,
        end_date: t?.end_date != null && String(t.end_date).trim() !== "" ? String(t.end_date) : null,
        end_count:
          t?.end_count != null && Number.isFinite(Number(t.end_count)) ? Number(t.end_count) : null,
        bg_color: t?.bg_color != null ? String(t.bg_color) : null,
      }))
      .filter((t) => t.kind && t.date && Number.isFinite(t.amount) && t.amount > 0);
    return { timeZone: "", account, transactions };
  } catch (_) {
    return null;
  }
}

/**
 * Create the user's first account from the wizard draft. Returns:
 *   { ok: true,  accountId: number }            — account created successfully
 *   { ok: true,  accountId: null, skipped: true } — nothing to create (no draft.account)
 *   { ok: false, accountId: null, error: string } — creation failed; draft should be retained
 *
 * Timeouts are intentionally generous (cold-start tolerance) because we'd rather wait a few
 * extra seconds than lose the user's onboarding data. The calendar page has a fallback that
 * retries from the draft if anything was missed.
 */
async function maybeCreateFirstAccountFromDraft(draft) {
  if (!draft || !draft.account) {
    return { ok: true, accountId: null, skipped: true };
  }
  let familyId = null;
  try {
    const fams = await requestWithRetry("/api/families", "GET", null, { maxMs: 12000 });
    if (!fams.ok || !Array.isArray(fams.data) || fams.data.length === 0) {
      return { ok: false, accountId: null, error: "no_family" };
    }
    familyId = fams.data[0]?.id;
    if (!familyId) return { ok: false, accountId: null, error: "no_family" };
  } catch (e) {
    return { ok: false, accountId: null, error: (e && e.message) || "families_fetch_failed" };
  }

  const a = draft.account;
  try {
    const created = await requestWithRetry(
      `/api/families/${encodeURIComponent(String(familyId))}/accounts`,
      "POST",
      {
        name: a.name,
        type: a.type,
        starting_balance: a.starting_balance,
        starting_balance_date: a.starting_balance_date,
      },
      { maxMs: 12000 }
    );
    if (created && created.ok && created.data && created.data.id) {
      return { ok: true, accountId: Number(created.data.id) };
    }
    return { ok: false, accountId: null, error: `account_create_failed_${created?.status || "network"}` };
  } catch (e) {
    return { ok: false, accountId: null, error: (e && e.message) || "account_create_threw" };
  }
}

/**
 * Create the user's first transactions from the wizard draft. Returns:
 *   { ok: true,  createdCount, totalCount }   — every applicable item created
 *   { ok: false, createdCount, totalCount, error }
 */
async function maybeCreateFirstTransactionFromDraft(draft, createdAccountId) {
  if (!draft) return { ok: true, createdCount: 0, totalCount: 0 };
  let familyId = null;
  try {
    const fams = await requestWithRetry("/api/families", "GET", null, { maxMs: 12000 });
    if (!fams.ok || !Array.isArray(fams.data) || fams.data.length === 0) {
      return { ok: false, createdCount: 0, totalCount: 0, error: "no_family" };
    }
    familyId = fams.data[0]?.id;
    if (!familyId) return { ok: false, createdCount: 0, totalCount: 0, error: "no_family" };
  } catch (e) {
    return { ok: false, createdCount: 0, totalCount: 0, error: (e && e.message) || "families_fetch_failed" };
  }

  const list = Array.isArray(draft.transactions) ? draft.transactions : [];
  let createdCount = 0;
  let totalApplicable = 0;
  let lastError = null;

  for (const t of list) {
    const description = (t.category || "").trim() || "Transaction";
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    totalApplicable += 1;
    const txDate = accountSetupEffectiveTxDate(t.date, draft);
    try {
      if (t.recurring) {
        const accountId = Number(createdAccountId);
        if (!Number.isFinite(accountId) || accountId <= 0) {
          lastError = "missing_account_for_recurring";
          continue;
        }
        const r = await requestWithRetry(
          `/api/families/${encodeURIComponent(String(familyId))}/expected-transactions`,
          "POST",
          {
            account_id: accountId,
            start_date: txDate,
            end_date: t.end_date || null,
            end_count: t.end_date ? null : t.end_count ?? null,
            recurrence: t.recurrence || "monthly",
            second_day_of_month: t.recurrence === "twice_monthly" ? t.second_day_of_month ?? null : null,
            description,
            notes: t.notes ? t.notes : null,
            kind: t.kind,
            amount,
            variable: !!t.variable,
            category_id: null,
            bg_color: t.bg_color ? t.bg_color : null,
            fg_color: null,
          },
          { maxMs: 12000 }
        );
        if (r && r.ok) createdCount += 1;
        else lastError = `expected_create_failed_${r?.status || "network"}`;
      } else {
        const r = await requestWithRetry(
          `/api/families/${encodeURIComponent(String(familyId))}/transactions`,
          "POST",
          {
            date: txDate,
            description,
            notes: t.notes ? t.notes : null,
            kind: t.kind,
            amount,
            category_id: null,
            fg_color: null,
            bg_color: t.bg_color ? t.bg_color : null,
            reimbursable: false,
          },
          { maxMs: 12000 }
        );
        if (r && r.ok) createdCount += 1;
        else lastError = `transaction_create_failed_${r?.status || "network"}`;
      }
    } catch (e) {
      lastError = (e && e.message) || "transaction_create_threw";
    }
  }

  if (totalApplicable === 0) return { ok: true, createdCount: 0, totalCount: 0 };
  return {
    ok: createdCount === totalApplicable,
    createdCount,
    totalCount: totalApplicable,
    error: createdCount === totalApplicable ? null : lastError,
  };
}

async function maybePatchForecastThresholdsFromDraft(draft) {
  const minNum = resolveMinBalanceThresholdFromSignupDraft(draft);
  let familyId = null;
  try {
    const fams = await requestWithRetry("/api/families", "GET", null, { maxMs: 12000 });
    if (!fams.ok || !Array.isArray(fams.data) || fams.data.length === 0) {
      return { ok: false, error: "no_family" };
    }
    familyId = fams.data[0]?.id;
    if (!familyId) return { ok: false, error: "no_family" };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "families_fetch_failed" };
  }
  try {
    const r = await requestWithRetry(
      `/api/families/${encodeURIComponent(String(familyId))}/forecast-thresholds`,
      "PATCH",
      { balance_threshold_min: minNum },
      { maxMs: 12000 }
    );
    if (r && r.ok) return { ok: true, skipped: false };
    return { ok: false, error: `threshold_patch_${r?.status || "network"}` };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "threshold_patch_threw" };
  }
}

async function doSignup() {
  if (!signupBtn) return;
  if (bwSignupInFlight) return;
  bwSignupInFlight = true;
  bwEmailPrecheckStep0Generation += 1;
  setBusy(true);
  const isAccountSetup = isAccountSetupPath();
  const startedAt = Date.now();
  const minOverlayMs = 3200;
  let overlay = null;
  try {
    overlay = ensureForecastBuildOverlay();
    if (isAccountSetup) {
      setCallout(signupCalloutEl, "", "");
      showForecastBuildOverlay(overlay, { steadyProgress: true, rotateMessages: false });
      setForecastBuildOverlayMessage(overlay, "Preparing your forecast…");
      prefetchCalendarPage();
    } else {
      setCallout(signupCalloutEl, "Creating your account...", "pending");
    }
  } catch (_) {
    setCallout(signupCalloutEl, "Creating your account...", "pending");
  }
  try {
    try {
      sessionStorage.removeItem(BW_API_ACCESS_TOKEN_KEY);
    } catch (_) {}
    const draft = readAccountSetupDraft();
    if (!draft) {
      if (isAccountSetup && overlay) hideForecastBuildOverlay(overlay);
      setCallout(signupCalloutEl, "Please complete account setup first.", "error");
      const q = window.location.search || "";
      window.location.assign("/account-setup" + q);
      return;
    }
    const email = (document.getElementById("email")?.value || "").trim().toLowerCase();
    const password = document.getElementById("password")?.value || "";
    const password2 = document.getElementById("password2")?.value || "";

    if (!email) throw new Error("Email is required.");
    if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (password !== password2) throw new Error("Passwords do not match.");

    const name = (() => {
      const local = String(email).split("@")[0] || "";
      const cleaned = local.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
      return cleaned || "User";
    })();

    if (isAccountSetup && overlay) {
      setForecastBuildOverlayMessage(overlay, "Creating your account…");
      bumpForecastBuildOverlayProgress(overlay, 28);
    }

    const dupCheck = await precheckEmailExistsFresh(email);
    if (dupCheck && dupCheck.ok && dupCheck.exists === true) {
      if (isAccountSetup && overlay) hideForecastBuildOverlay(overlay);
      setCallout(signupCalloutEl, "", "");
      openAccountSetupDuplicateEmailModal();
      return;
    }

    const reg = await requestWithRetry("/api/auth/register", "POST", { name, email, password }, { maxMs: 14000 });
    if (!reg.ok) {
      if (isAccountSetup && overlay) hideForecastBuildOverlay(overlay);
      if (reg.status === 409 && isAccountSetup) {
        try {
          bwEmailCheckCache = { email, checkedAt: Date.now(), exists: true, pending: null };
        } catch (_) {}
        setCallout(signupCalloutEl, "", "");
        openAccountSetupDuplicateEmailModal();
        return;
      }
      setCallout(signupCalloutEl, messageFromFailure(reg, "Signup failed."), "error");
      return;
    }
    try {
      const tok = reg.data && reg.data.access_token != null ? String(reg.data.access_token).trim() : "";
      if (tok) sessionStorage.setItem(BW_API_ACCESS_TOKEN_KEY, tok);
    } catch (_) {}
    try {
      bwEmailPrecheckStep0Generation += 1;
      bwEmailCheckCache = { email, checkedAt: Date.now(), exists: true, pending: null };
    } catch (_) {}

    if (isAccountSetup && overlay) {
      setForecastBuildOverlayMessage(overlay, "Saving your income and bills…");
      bumpForecastBuildOverlayProgress(overlay, 52);
    }

    const check = await verifySessionWithProgress(signupCalloutEl, {
      silent: isAccountSetup,
      onStatus: isAccountSetup && overlay
        ? (msg) => setForecastBuildOverlayMessage(overlay, msg)
        : null,
    });
    if (!check.ok) {
      if (isAccountSetup && overlay) hideForecastBuildOverlay(overlay);
      setCallout(
        signupCalloutEl,
        "Account was created, but we could not confirm your session. Try the Login page with the same email and password.",
        "error"
      );
      return;
    }

    // Set an initial billing anchor date so Settings → Billing can show next billing date.
    try {
      const existing = localStorage.getItem("bw_billing_start") || "";
      if (!existing) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        localStorage.setItem("bw_billing_start", `${y}-${m}-${d}`);
      }
    } catch (_) {}

    // If the user entered a starter account during setup, create it now.
    // We deliberately wait for both helpers to finish (with cold-start-tolerant timeouts)
    // before redirecting — otherwise the user lands on /calendar with no data.
    const accountResult = await maybeCreateFirstAccountFromDraft(draft);
    const createdAccountId = accountResult && accountResult.accountId ? accountResult.accountId : null;
    const [txResult, thresholdResult] = await Promise.all([
      maybeCreateFirstTransactionFromDraft(draft, createdAccountId),
      maybePatchForecastThresholdsFromDraft(draft),
    ]);
    if (thresholdResult && !thresholdResult.ok && !thresholdResult.skipped) {
      try {
        if (window.console && console.warn) console.warn("[signup] forecast threshold update failed", thresholdResult);
      } catch (_) {}
    }

    // Only clear the draft when everything that should have been created actually was.
    // Otherwise we leave it in sessionStorage so the /calendar bootstrap can finish the job.
    const accountStepOk =
      !draft.account || (accountResult && accountResult.ok && (accountResult.accountId || accountResult.skipped));
    const txStepOk = txResult && txResult.ok;
    if (accountStepOk && txStepOk) {
      try {
        removeAccountSetupDraftStorage();
      } catch (_) {}
    } else {
      try {
        if (window.console && console.warn) {
          console.warn("[signup] partial setup; leaving draft for /calendar recovery", {
            accountResult,
            txResult,
          });
        }
      } catch (_) {}
    }

    if (isAccountSetup && overlay) {
      await ensureMinOverlayDuration(startedAt, minOverlayMs);
      bumpForecastBuildOverlayProgress(overlay, 78);
      setForecastBuildOverlayMessage(overlay, "Opening your forecast…");
      finishForecastBuildOverlayProgress(overlay);
    }
    setCallout(signupCalloutEl, "", "");
    try {
      sessionStorage.setItem(BW_FORECAST_READY_POPUP_KEY, "1");
    } catch (_) {}
    // Keep the overlay visible until navigation — hiding early left users on the survey step.
    await goApp();
  } catch (e) {
    if (isAccountSetup && overlay) hideForecastBuildOverlay(overlay);
    setCallout(signupCalloutEl, calloutText(e && e.message ? e.message : e, "Signup failed."), "error");
  } finally {
    bwSignupInFlight = false;
    setBusy(false);
  }
}

/**
 * Full-screen overlay while signup + initial forecast data are created.
 * Work runs during the overlay; the bar completes when work finishes (not on a
 * fixed timer). `durationMs` is a ceiling for the fill animation only.
 */
const FORECAST_BUILD_MESSAGES = [
  "Building your cash timeline…",
  "Calculating recurring impacts…",
  "Looking for low-balance periods…",
  "Aligning paydays and bills…",
  "Almost ready…",
];

const FORECAST_BUILD_PROGRESS_CAP = 92;
const FORECAST_BUILD_PROGRESS_TICK_MS = 110;

function stopForecastBuildOverlayRotation(overlayEl) {
  if (!overlayEl || !overlayEl._bwMsgInterval) return;
  try {
    clearInterval(overlayEl._bwMsgInterval);
  } catch (_) {}
  overlayEl._bwMsgInterval = null;
}

function stopForecastBuildOverlayProgress(overlayEl) {
  if (!overlayEl || !overlayEl._bwProgressInterval) return;
  try {
    clearInterval(overlayEl._bwProgressInterval);
  } catch (_) {}
  overlayEl._bwProgressInterval = null;
}

function forecastBuildOverlayFillPct(overlayEl) {
  const fill = overlayEl?.querySelector(".bw-build-overlay__barFill");
  if (!fill) return 0;
  const inline = parseFloat(String(fill.style.width || "").replace("%", ""));
  if (Number.isFinite(inline) && inline > 0) return inline;
  return 0;
}

function startForecastBuildOverlayProgress(overlayEl) {
  const fill = overlayEl?.querySelector(".bw-build-overlay__barFill");
  if (!fill) return;
  stopForecastBuildOverlayProgress(overlayEl);
  fill.classList.remove("bw-build-overlay__barFill--indeterminate");
  fill.style.transform = "";
  fill.style.animation = "";
  fill.style.transition = `width ${FORECAST_BUILD_PROGRESS_TICK_MS}ms linear`;
  fill.style.width = "0%";
  let pct = 0;
  overlayEl._bwProgressInterval = window.setInterval(() => {
    if (pct >= FORECAST_BUILD_PROGRESS_CAP) return;
    const remaining = FORECAST_BUILD_PROGRESS_CAP - pct;
    const step = Math.max(0.3, remaining * 0.05);
    pct = Math.min(FORECAST_BUILD_PROGRESS_CAP, pct + step);
    fill.style.width = `${pct}%`;
  }, FORECAST_BUILD_PROGRESS_TICK_MS);
}

function bumpForecastBuildOverlayProgress(overlayEl, floorPct) {
  const fill = overlayEl?.querySelector(".bw-build-overlay__barFill");
  if (!fill) return;
  const current = forecastBuildOverlayFillPct(overlayEl);
  const next = Math.max(current, Math.min(FORECAST_BUILD_PROGRESS_CAP, floorPct));
  if (next <= current) return;
  fill.style.transition = "width 320ms linear";
  fill.style.width = `${next}%`;
}

function finishForecastBuildOverlayProgress(overlayEl) {
  const fill = overlayEl?.querySelector(".bw-build-overlay__barFill");
  stopForecastBuildOverlayProgress(overlayEl);
  if (!fill) return;
  fill.classList.remove("bw-build-overlay__barFill--indeterminate");
  fill.style.transform = "";
  fill.style.animation = "";
  fill.style.transition = "width 420ms ease-out";
  fill.style.width = "100%";
}

function setForecastBuildOverlayMessage(overlayEl, text) {
  if (!overlayEl) return;
  stopForecastBuildOverlayRotation(overlayEl);
  const msgEl = overlayEl.querySelector("#bwForecastBuildMessage");
  if (!msgEl) return;
  msgEl.textContent = String(text || "");
  msgEl.classList.add("bw-build-overlay__message--show");
}

function ensureForecastBuildOverlay() {
  const existing = document.getElementById("bwForecastBuildOverlay");
  if (existing) return existing;
  const wrap = document.createElement("div");
  wrap.id = "bwForecastBuildOverlay";
  wrap.className = "bw-build-overlay";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="bw-build-overlay__card" role="status" aria-live="polite" aria-label="Preparing your forecast">
      <div class="bw-build-overlay__title">Preparing your forecast…</div>
      <div class="bw-build-overlay__message" id="bwForecastBuildMessage">Building your cash timeline…</div>
      <div class="bw-build-overlay__bar" aria-hidden="true">
        <div class="bw-build-overlay__barFill"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  return wrap;
}

function showForecastBuildOverlay(
  overlayEl,
  { durationMs = 5000, rotateMessages = true, indeterminate = false, steadyProgress = false } = {}
) {
  if (!overlayEl) return;
  overlayEl.hidden = false;
  overlayEl.classList.add("bw-build-overlay--open");
  const fill = overlayEl.querySelector(".bw-build-overlay__barFill");
  const useSteadyProgress = steadyProgress || indeterminate;
  if (fill) {
    fill.classList.remove("bw-build-overlay__barFill--indeterminate");
    if (useSteadyProgress) {
      startForecastBuildOverlayProgress(overlayEl);
    } else {
      stopForecastBuildOverlayProgress(overlayEl);
      fill.style.transition = "none";
      fill.style.width = "0%";
      requestAnimationFrame(() => {
        fill.style.transition = `width ${Math.max(0, durationMs)}ms linear`;
        fill.style.width = "100%";
      });
    }
  }
  const msgEl = overlayEl.querySelector("#bwForecastBuildMessage");
  if (!msgEl) return;
  stopForecastBuildOverlayRotation(overlayEl);
  if (!rotateMessages) {
    msgEl.classList.add("bw-build-overlay__message--show");
    return;
  }
  let idx = 0;
  msgEl.textContent = FORECAST_BUILD_MESSAGES[0];
  msgEl.classList.remove("bw-build-overlay__message--show");
  requestAnimationFrame(() => msgEl.classList.add("bw-build-overlay__message--show"));
  overlayEl._bwMsgInterval = window.setInterval(() => {
    idx = (idx + 1) % FORECAST_BUILD_MESSAGES.length;
    msgEl.classList.remove("bw-build-overlay__message--show");
    window.setTimeout(() => {
      msgEl.textContent = FORECAST_BUILD_MESSAGES[idx];
      msgEl.classList.add("bw-build-overlay__message--show");
    }, 220);
  }, 2400);
}

function hideForecastBuildOverlay(overlayEl) {
  if (!overlayEl) return;
  stopForecastBuildOverlayRotation(overlayEl);
  stopForecastBuildOverlayProgress(overlayEl);
  overlayEl.classList.remove("bw-build-overlay--open");
  overlayEl.hidden = true;
  const fill = overlayEl.querySelector(".bw-build-overlay__barFill");
  if (fill) {
    fill.classList.remove("bw-build-overlay__barFill--indeterminate");
    fill.style.transform = "";
    fill.style.animation = "";
    fill.style.transition = "none";
    fill.style.width = "0%";
  }
}

async function finishForecastBuildOverlay(overlayEl, { message = "Opening your forecast…" } = {}) {
  if (!overlayEl) return;
  setForecastBuildOverlayMessage(overlayEl, message);
  finishForecastBuildOverlayProgress(overlayEl);
  await new Promise((r) => setTimeout(r, 440));
  hideForecastBuildOverlay(overlayEl);
}

// Plan note (for future billing wiring).
try {
  const plan = parsePlanFromQuery();
  if (signupPlanNoteEl && plan) {
    signupPlanNoteEl.style.display = "block";
    signupPlanNoteEl.classList.toggle("signup-plan-note--pro", plan === "pro");
    signupPlanNoteEl.textContent = plan === "pro" ? "Selected Plan: Add Budgeting" : "Selected Plan: Cash Forecast";
    showSignupPlanBanner();
  }
} catch (_) {}
try {
  persistBillingSelectionFromQuery();
} catch (_) {}

try {
  const t = new URLSearchParams(location.search).get("invite");
  if (t && String(t).trim()) sessionStorage.setItem("bw_invite_token", String(t).trim());
  else sessionStorage.removeItem("bw_invite_token");
} catch (_) {}

async function applyInvitePrefill() {
  const raw = new URLSearchParams(location.search).get("invite") || sessionStorage.getItem("bw_invite_token") || "";
  const token = String(raw || "").trim();
  if (!token) return;
  try {
    sessionStorage.setItem("bw_invite_token", token);
  } catch (_) {}
  const enc = encodeURIComponent(token);
  const r = await request(`/api/public/invites/by-token/${enc}`, "GET");
  if (!r.ok || !r.data || !r.data.ok) return;
  const emailEl = document.getElementById("email");
  if (emailEl) {
    emailEl.value = String(r.data.invitee_email || "");
    emailEl.readOnly = true;
  }
  if (signupPlanNoteEl) {
    signupPlanNoteEl.style.display = "block";
    signupPlanNoteEl.classList.remove("signup-plan-note--pro");
    signupPlanNoteEl.textContent = "You are signing up to accept a family invitation. Use the email above.";
    showSignupPlanBanner();
  }
}

void (async () => {
  await applyInvitePrefill();
  if (isAccountSetupPath()) {
    try {
      const params = new URLSearchParams(String(window.location.search || ""));
      if (params.get("fresh") === "1") removeAccountSetupDraftStorage();
    } catch (_) {}
    scheduleAuthApiWarmup();
  }
  hydrateAccountSetupDraft();
  try {
    initAccountSetupMoneyFields();
  } catch (_) {}
  try {
    initAccountSetupTransactionUi();
  } catch (_) {}
  try {
    ensureAccountStartingBalanceDateDefault();
    ensureAccountSetupDefaultAccountName();
  } catch (_) {}

  // Warm up the email availability check while the user is still typing Step 0.
  try {
    const emailEl = document.getElementById("email");
    if (emailEl) {
      let t = null;
      const kickPrecheckIfStep0 = () => {
        if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
        if (getAccountSetupWizardStep() !== 0) return;
        const em = String(emailEl.value || "").trim();
        if (!em.includes("@") || em.length < 5) return;
        if (t) window.clearTimeout(t);
        const delay = emailLooksPlausibleForPrecheckDebounce(em) ? 90 : 220;
        t = window.setTimeout(() => void precheckEmailExists(em), delay);
      };
      emailEl.addEventListener("input", kickPrecheckIfStep0);
      emailEl.addEventListener("blur", () => void precheckEmailExists(emailEl.value));
      document.getElementById("password")?.addEventListener("input", kickPrecheckIfStep0);
      document.getElementById("password2")?.addEventListener("input", kickPrecheckIfStep0);
      const pref = String(emailEl.value || "").trim();
      if (pref.includes("@")) void precheckEmailExists(pref);
    }
  } catch (_) {}
})();

// Expose a global handler so the inline onclick works even if the event binding fails.
function onSignupPrimaryClick() {
  if (isAccountSetupPath()) {
    if (document.getElementById("accountSetupWizard")) {
      if (isAccountSetupWizardStepLocked()) return;
      setCallout(signupCalloutEl, "", "");
      const st = getAccountSetupWizardStep();
      if (st === 0) {
        const email = (document.getElementById("email")?.value || "").trim();
        const password = document.getElementById("password")?.value || "";
        const password2 = document.getElementById("password2")?.value || "";
        if (!email) {
          setCallout(signupCalloutEl, "Email is required.", "error");
          return;
        }
        if (!password || password.length < 8) {
          setCallout(signupCalloutEl, "Password must be at least 8 characters.", "error");
          return;
        }
        if (password !== password2) {
          setCallout(signupCalloutEl, "Passwords do not match.", "error");
          return;
        }
        // Don't block Next on network latency. Move forward immediately and let the
        // email check finish in the background; if it's a duplicate, bounce back.
        // Run the email check in the background; don't let a "Checking email…" banner
        // persist into the next step.
        setCallout(signupCalloutEl, "", "");
        const step0PrecheckGen = bwEmailPrecheckStep0Generation;
        const emailChecked = String(email || "").trim().toLowerCase();
        const p = precheckEmailExists(email);
        lockAccountSetupWizardStepTransition();
        setAccountSetupWizardStep(1);
        focusAccountSetupAccountNameInput();
        Promise.resolve(p)
          .then((cached) => {
            if (step0PrecheckGen !== bwEmailPrecheckStep0Generation) return;
            if (!shouldShowDuplicateEmailModalFromPrecheck()) return;
            const emNow = String(document.getElementById("email")?.value || "").trim().toLowerCase();
            if (emNow !== emailChecked) return;
            if (!cached || !cached.ok) {
              // Non-blocking: user can continue; register will still enforce uniqueness.
              setCallout(signupCalloutEl, "", "");
              return;
            }
            if (cached.exists === true) {
              setCallout(signupCalloutEl, "", "");
              openAccountSetupDuplicateEmailModal();
              return;
            }
            setCallout(signupCalloutEl, "", "");
          })
          .catch(() => setCallout(signupCalloutEl, "", ""));
        return;
      }
      if (st === 1) {
        const accountName = (document.getElementById("accountName")?.value || "").trim();
        const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
        const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
        const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
        const gate = canAdvanceAccountSetupAccountStep({
          accountName,
          accountStartingBalanceRaw,
          accountStartingBalance,
          accountStartingBalanceDate,
          checkingCushionRaw: accountSetupCheckingCushionRawFromDom(),
        });
        if (showAccountSetupAccountGateError(gate)) return;
        if (!gate.anyAccount) {
          setCallout(signupCalloutEl, "Please complete this step to continue.", "error");
          return;
        }
        try {
          const rawDraft = readAccountSetupDraftRaw() || {};
          persistAccountSetupDraftObject({
              ...rawDraft,
              wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
              wizardStep: 2,
              step3Phase: "intro",
              expensePhase: "intro",
              ...(gate.anyAccount
                ? {
                    account: {
                      name: accountName,
                      type: "checking",
                      starting_balance: accountStartingBalance,
                      starting_balance_date: accountStartingBalanceDate,
                      balance_threshold_min: gate.cushionThresholdMin,
                    },
                  }
                : {}),
            });

        } catch (_) {}
        lockAccountSetupWizardStepTransition();
        setAccountSetupWizardStep(2, { skipPersist: true });
        setAccountSetupStep3Phase("intro");
        document.getElementById("asTxHubAddIncomeBtn")?.focus();
        return;
      }
      if (st === 2) {
        if (getAccountSetupStep3Phase() !== "intro") return;
        if (getAccountSetupTransactionCounts().totalCount < 1) return;
        accountSetupTxHubContinueClick();
        return;
      }
      if (st === 3) {
        return;
      }
      if (st === 4) {
        setCallout(signupCalloutEl, "", "");
        try {
          const wrap = document.getElementById("accountSetupWizardPanel4");
          const buttons = wrap ? [...wrap.querySelectorAll("[data-as-survey-opt]")] : [];
          const selected = buttons
            .filter((b) => b.classList.contains("is-active"))
            .map((b) => String(b.getAttribute("data-as-survey-opt") || "").trim())
            .filter(Boolean);
          const otherVal = String(document.getElementById("accountSetupSurveyOther")?.value || "").trim();
          if (!selected.length) {
            setCallout(signupCalloutEl, "Please choose at least one option.", "error");
            return;
          }
          const rawDraft = readAccountSetupDraftRaw() || {};
          persistAccountSetupDraftObject({
              ...rawDraft,
              wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
              wizardStep: 4,
              surveyHelpWith: selected,
              surveyOther: selected.includes("other") ? otherVal : "",
            });

        } catch (_) {}
        if (bwSignupInFlight) return;
        void doSignup();
        return;
      }
    }

    if (getAccountSetupStep() === "account") {
      setCallout(signupCalloutEl, "", "");
      try {
        const accountName = (document.getElementById("accountName")?.value || "").trim();
        const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
        const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
        const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
        const gate = canAdvanceAccountSetupAccountStep({
          accountName,
          accountStartingBalanceRaw,
          accountStartingBalance,
          accountStartingBalanceDate,
          checkingCushionRaw: accountSetupCheckingCushionRawFromDom(),
        });
        if (showAccountSetupAccountGateError(gate)) {
          setAccountSetupStep("account");
          return;
        }
        persistAccountSetupDraftObject({
            ...(gate.anyAccount
              ? {
                  account: {
                    name: accountName,
                    type: "checking",
                    starting_balance: accountStartingBalance,
                    starting_balance_date: accountStartingBalanceDate,
                    balance_threshold_min: gate.cushionThresholdMin,
                  },
                }
              : {}),
            step: "transactions",
          });

      } catch (_) {}
      setAccountSetupStep("transactions");
      return;
    }
    void goToSignupFromAccountSetup();
  }
  else if (isSignupPath()) void doSignup();
  else void goToAccountSetup();
}

function onAccountSetupSkipAccountClick() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  const st = getAccountSetupWizardStep();
  if (st !== 1 && st !== 2) return;
  setCallout(signupCalloutEl, "", "");
  if (st === 1) {
    try {
      const rawDraft = readAccountSetupDraftRaw() || {};
      const next = {
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "intro",
        expensePhase: "intro",
      };
      delete next.account;
      persistAccountSetupDraftObject(next);
    } catch (_) {}
    lockAccountSetupWizardStepTransition();
    setAccountSetupWizardStep(2, { skipPersist: true });
    setAccountSetupStep3Phase("intro");
    document.getElementById("asTxHubAddIncomeBtn")?.focus();
    return;
  }

  // Step 3 Skip: jump to survey (Step 4).
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(4, { skipPersist: true });
  document.querySelector("[data-as-survey-opt]")?.focus();
}
window.__bwSignup = onSignupPrimaryClick;
if (signupBtn) {
  signupBtn.addEventListener("pointerdown", () => speculativePrecheckEmailIfStep0Ready(), { capture: true });
  signupBtn.addEventListener("click", onSignupPrimaryClick);
}
accountSetupSkipBtn?.addEventListener("click", onAccountSetupSkipAccountClick);
const password2El = document.getElementById("password2");
if (password2El) {
  password2El.addEventListener("keydown", (e) => {
    const k = String(e.key || "");
    if (k !== "Enter" && k !== "NumpadEnter" && (e.keyCode || 0) !== 13) return;
    speculativePrecheckEmailIfStep0Ready();
    // Mirror clicking "Next" from the password confirm field.
    e.preventDefault();
    onSignupPrimaryClick();
  });
}

const accountStartingBalanceEl = document.getElementById("accountStartingBalance");
if (accountStartingBalanceEl) {
  accountStartingBalanceEl.addEventListener("keydown", (e) => {
    const k = String(e.key || "");
    if (k !== "Enter" && k !== "NumpadEnter" && (e.keyCode || 0) !== 13) return;
    if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
    if (getAccountSetupWizardStep() !== 1) return;
    // Mirror clicking "Next" from the starting balance field.
    e.preventDefault();
    onSignupPrimaryClick();
  });
}

const accountSetupKeepInCheckingEl = document.getElementById("accountSetupKeepInChecking");
if (accountSetupKeepInCheckingEl) {
  accountSetupKeepInCheckingEl.addEventListener("keydown", (e) => {
    const k = String(e.key || "");
    if (k !== "Enter" && k !== "NumpadEnter" && (e.keyCode || 0) !== 13) return;
    if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
    if (getAccountSetupWizardStep() !== 1) return;
    e.preventDefault();
    onSignupPrimaryClick();
  });
}

if (addMoreTxBtn) addMoreTxBtn.addEventListener("click", addMoreTransactionsFromAccountSetup);
document.getElementById("asTxSaveIncomeBtn")?.addEventListener("click", () => void accountSetupSaveIncomeClick());
document.getElementById("asTxCancelIncomeBtn")?.addEventListener("pointerdown", accountSetupCancelIncomeClick, { capture: true });
document.getElementById("asTxCancelIncomeBtn")?.addEventListener("click", () => accountSetupCancelIncomeClick());
document.getElementById("asTxHubAddIncomeBtn")?.addEventListener("click", () => accountSetupTxHubAddIncomeClick());
document.getElementById("asTxHubAddExpenseBtn")?.addEventListener("click", () => accountSetupTxHubAddExpenseClick());
document.getElementById("asStep3SuccessAddIncomeBtn")?.addEventListener("click", () => advanceAccountSetupWizardToIncomeFormFromSuccess());
document.getElementById("asStep3SuccessAddExpenseBtn")?.addEventListener("click", () => advanceAccountSetupWizardToExpenseForm());
document.getElementById("asStep3ContinueBtn")?.addEventListener("click", () => accountSetupCancelIncomeClick());
document.getElementById("asExpSaveBtn")?.addEventListener("click", () => void accountSetupSaveExpenseClick());
document.getElementById("asExpCancelBtn")?.addEventListener("pointerdown", accountSetupCancelExpenseClick, { capture: true });
document.getElementById("asExpCancelBtn")?.addEventListener("click", () => accountSetupCancelExpenseClick());
try {
  const p4 = document.getElementById("accountSetupWizardPanel4");
  if (p4) {
    const buttons = [...p4.querySelectorAll("[data-as-survey-opt]")];
    const otherWrap = document.getElementById("accountSetupSurveyOtherWrap");
    const otherInput = document.getElementById("accountSetupSurveyOther");
    const syncOtherWrap = () => {
      const otherBtn = buttons.find((b) => String(b.getAttribute("data-as-survey-opt")) === "other");
      const on = !!(otherBtn && otherBtn.classList.contains("is-active"));
      if (otherWrap) otherWrap.hidden = !on;
      if (!on && otherInput) otherInput.value = "";
    };
    for (const b of buttons) {
      b.addEventListener("click", () => {
        b.classList.toggle("is-active");
        b.setAttribute("aria-pressed", b.classList.contains("is-active") ? "true" : "false");
        syncOtherWrap();
        if (String(b.getAttribute("data-as-survey-opt")) === "other" && b.classList.contains("is-active") && otherInput) {
          otherInput.focus();
        }
      });
    }
  }
} catch (_) {}
function handleAccountSetupBack(e) {
  // Avoid preventDefault here: on some browsers it can cancel the subsequent click,
  // making the Back button feel unresponsive.
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  const s = getAccountSetupWizardStep();
  if (s <= 0) return;
  setCallout(signupCalloutEl, "", "");
  if (s === 2 && getAccountSetupStep3Phase() === "form") {
    // From the transaction form (pre-save), Back should return to the Step 3 intro hub.
    if (!isAccountSetupStep3AfterSave()) {
      try {
        const rawDraft = readAccountSetupDraftRaw() || {};
        persistAccountSetupDraftObject({
            ...rawDraft,
            wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
            wizardStep: 2,
            step3Phase: "intro",
            expensePhase: "intro",
          });

      } catch (_) {}
      setAccountSetupStep3Phase("intro");
      try {
        document.getElementById("asTxHubAddIncomeBtn")?.focus();
      } catch (_) {}
      return;
    }

    // If Back is ever visible in the post-save state, return to the account step.
    lockAccountSetupWizardStepTransition();
    setAccountSetupWizardStep(1, { skipPersist: true });
    try {
      const rawDraft = readAccountSetupDraftRaw() || {};
      persistAccountSetupDraftObject({
          ...rawDraft,
          wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
          wizardStep: 1,
          step3Phase: "form",
          expensePhase: "intro",
        });

    } catch (_) {}
    focusAccountSetupAccountNameInput();
    return;
  }
  if (s === 3 && getAccountSetupExpensePhase() === "form") {
    // From the expense form, Back should return to the Step 3 confirmation view.
    lockAccountSetupWizardStepTransition();
    setAccountSetupWizardStep(2, { skipPersist: true });
    setAccountSetupStep3Phase("form");
    setAccountSetupStep3AfterSave(true);
    setAccountSetupExpensePhase("intro");
    try {
      const rawDraft = readAccountSetupDraftRaw() || {};
      persistAccountSetupDraftObject({
          ...rawDraft,
          wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
          wizardStep: 2,
          step3Phase: "form",
          expensePhase: "intro",
        });

    } catch (_) {}
    return;
  }
  if (s === 4) {
    const raw = readAccountSetupDraftRaw() || {};
    const wantExpenseForm = String(raw.expensePhase || "") === "form";
    // If the user never opened the expense form, going "back" from the survey should
    // return to the transactions hub (step 2). Step 3 has no intro UI, so showing it
    // in "intro" mode would appear blank.
    if (wantExpenseForm) {
      setAccountSetupWizardStep(3, { skipPersist: true });
      setAccountSetupExpensePhase("form");
      document.getElementById("asExpTxAmount")?.focus();
    } else {
      setAccountSetupWizardStep(2, { skipPersist: true });
      setAccountSetupStep3Phase("intro");
      document.getElementById("asTxHubAddIncomeBtn")?.focus();
    }
    return;
  }
  setAccountSetupWizardStep(s - 1);
  const ns = s - 1;
  if (ns === 0) document.getElementById("email")?.focus();
  else if (ns === 1) document.getElementById("accountName")?.focus();
  else if (ns === 2) {
    const raw = readAccountSetupDraftRaw() || {};
    if (String(raw.step3Phase || "") === "form") document.getElementById("asTxAmount")?.focus();
    else document.getElementById("asTxHubAddIncomeBtn")?.focus();
  } else if (ns === 3) {
    const raw = readAccountSetupDraftRaw() || {};
    if (String(raw.expensePhase || "") === "form") document.getElementById("asExpTxAmount")?.focus();
    else document.getElementById("asTxHubAddExpenseBtn")?.focus();
  }
}

if (accountSetupBackBtn) {
  // Use pointerdown so it still works even if a later click is swallowed.
  accountSetupBackBtn.addEventListener("pointerdown", handleAccountSetupBack, { capture: true });
  accountSetupBackBtn.addEventListener("click", handleAccountSetupBack);
}

/**
 * Quick-pick category chips for the onboarding transaction forms.
 *
 * Most users entering their first 2–3 recurring items pick from a tiny set of
 * categories (paycheck, mortgage, credit card, utility, etc.). The chips skip
 * the category combobox search entirely: clicking a chip sets the hidden
 * category id, mirrors the label into the visible search box, dispatches the
 * "change" event so recurrence defaults still fire, then focuses the Amount
 * field so the user can keep typing.
 */
const ACCOUNT_SETUP_INCOME_CHIPS = [
  { label: "Paycheck", value: "Paycheck" },
  { label: "Transfer in", value: "Transfer In" },
  { label: "Other income", value: "Other Income" },
];
const ACCOUNT_SETUP_EXPENSE_CHIPS = [
  { label: "Mortgage / Rent", value: "Mortgage/Rent" },
  { label: "Credit Card", value: "Credit Card Payment" },
  { label: "Utility", value: "Utility" },
  { label: "Insurance", value: "Insurance" },
  { label: "Subscription", value: "Subscription" },
];

function applyAccountSetupChipSelection(prefix, value) {
  const hidden = document.getElementById(prefix + "Category");
  const search = document.getElementById(prefix + "CategorySearch");
  const amount = document.getElementById(prefix + "Amount");
  if (hidden) {
    hidden.value = value || "";
    delete hidden.dataset.asCategoryKindForCustom;
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (search) {
    search.value = value || "";
    // Briefly highlight the input so users see what was filled in.
    try {
      search.classList.add("category-search__input--prefilled");
      window.setTimeout(() => search.classList.remove("category-search__input--prefilled"), 600);
    } catch (_) {}
  }
  if (amount) {
    try { amount.focus({ preventScroll: true }); } catch (_) { amount.focus(); }
  }
}

function renderAccountSetupCategoryChips(prefix, kind) {
  const containerId = prefix === "asTx" ? "asTxQuickChips" : "asExpTxQuickChips";
  const container = document.getElementById(containerId);
  if (!container) return;
  const chips = String(kind).toLowerCase() === "income" ? ACCOUNT_SETUP_INCOME_CHIPS : ACCOUNT_SETUP_EXPENSE_CHIPS;
  // If chips already rendered for this kind, just update active state.
  if (container.dataset.kind === kind) {
    const cur = (document.getElementById(prefix + "Category")?.value || "").trim();
    for (const btn of container.querySelectorAll(".as-quick-chip")) {
      btn.classList.toggle("is-active", btn.getAttribute("data-chip-value") === cur);
    }
    return;
  }
  container.dataset.kind = kind;
  container.innerHTML = "";
  const cur = (document.getElementById(prefix + "Category")?.value || "").trim();
  for (const chip of chips) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "as-quick-chip";
    btn.textContent = chip.label;
    btn.setAttribute("data-chip-value", chip.value);
    if (chip.value === cur) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      for (const other of container.querySelectorAll(".as-quick-chip")) other.classList.remove("is-active");
      btn.classList.add("is-active");
      applyAccountSetupChipSelection(prefix, chip.value);
    });
    container.appendChild(btn);
  }
}

function syncAccountSetupCategorySelectionForKind(hiddenId) {
  const hidden = document.getElementById(hiddenId);
  if (!hidden) return;
  const current = String(hidden.value || "").trim();
  if (!current) return;
  const kind = getAccountSetupCategoryKindForHiddenId(hiddenId);
  if (accountSetupStoredCategoryMatchesKind(hidden, kind)) return;
  clearAccountSetupCategoryCombobox(hiddenId);
}

function initAccountSetupQuickChips() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  // Panel 2 chips follow the visible Type radio.
  let asTxKindSticky = /** @type {string|null} */ (null);
  const update2 = () => {
    const checked = document.querySelector('input[name="asTxKind"]:checked');
    const kind = checked ? String(checked.value) : "expense";
    if (asTxKindSticky != null && kind && asTxKindSticky !== kind) {
      const amountEl = document.getElementById("asTxAmount");
      if (amountEl) amountEl.value = "";
      const notesEl = document.getElementById("asTxNotes");
      if (notesEl) notesEl.value = "";
      clearAccountSetupCategoryCombobox("asTxCategory");
      const recSel = document.getElementById("asTxRecurrence");
      if (recSel) recSel.value = "once";
      const endsModeEl = document.getElementById("asTxEndsMode");
      if (endsModeEl) endsModeEl.value = "never";
      const secondDayEl = document.getElementById("asTxSecondDayOfMonth");
      if (secondDayEl) secondDayEl.value = "";
      const endCountEl = document.getElementById("asTxEndCount");
      if (endCountEl) endCountEl.value = "";
      const endDateEl = document.getElementById("asTxEndDate");
      if (endDateEl) endDateEl.value = "";
      const varEl = document.getElementById("asTxVariable");
      if (varEl) varEl.checked = false;
      const bgEl = document.getElementById("asTxBgColor");
      if (bgEl) bgEl.value = "";
      const swatches = document.getElementById("asTxColorSwatches");
      if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
      syncAccountSetupScheduleUi("asTx");
    }
    asTxKindSticky = kind;
    syncAccountSetupCategorySelectionForKind("asTxCategory");
    renderAccountSetupCategoryChips("asTx", kind);
    const list = document.getElementById("asTxCategoryList");
    const input = document.getElementById("asTxCategorySearch");
    if (list && input && input.getAttribute("aria-expanded") === "true") {
      list.hidden = false;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  for (const r of document.querySelectorAll('input[name="asTxKind"]')) {
    r.addEventListener("change", update2);
  }
  update2();

  // Panel 3 is expense-only by visible affordance, but we still mirror the radio.
  const update3 = () => {
    const checked = document.querySelector('input[name="asExpTxKind"]:checked');
    const kind = checked ? checked.value : "expense";
    syncAccountSetupCategorySelectionForKind("asExpTxCategory");
    renderAccountSetupCategoryChips("asExpTx", kind);
    const list = document.getElementById("asExpTxCategoryList");
    const input = document.getElementById("asExpTxCategorySearch");
    if (list && input && input.getAttribute("aria-expanded") === "true") {
      list.hidden = false;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  for (const r of document.querySelectorAll('input[name="asExpTxKind"]')) {
    r.addEventListener("change", update3);
  }
  update3();
}

/**
 * Counts the income/expense items in the draft and renders a compact "✓ N
 * income, ✓ N expense(s)" summary list on the success state of each panel.
 * Pure derived UI — never persists state.
 */
function renderAccountSetupSuccessSummary(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  let draft = null;
  try { draft = readAccountSetupDraftRaw() || {}; } catch (_) { draft = {}; }
  const txs = Array.isArray(draft.transactions) ? draft.transactions : [];
  let incomeCount = 0;
  let expenseCount = 0;
  for (const t of txs) {
    const kind = String((t && t.kind) || "").toLowerCase();
    if (kind === "income") incomeCount += 1;
    else if (kind === "expense") expenseCount += 1;
  }
  list.innerHTML = "";
  const items = [];
  if (incomeCount === 1) items.push("Income added");
  else if (incomeCount > 1) items.push(`${incomeCount} income sources`);
  if (expenseCount === 1) items.push("Recurring expense added");
  else if (expenseCount > 1) items.push(`${expenseCount} recurring expenses`);
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "account-setup-success-summary__empty";
    li.textContent = "Add your first item to see your forecast start to take shape.";
    list.appendChild(li);
    return;
  }
  for (const text of items) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="account-setup-success-summary__check" aria-hidden="true">✓</span><span>${text}</span>`;
    list.appendChild(li);
  }
}

/** When category implies a typical cadence, enable Repeats and set recurrence (account setup wizard). */
function applyAccountSetupCategoryRecurrenceDefaults(categoryEl, prefix) {
  if (!categoryEl) return;
  const cat = String(categoryEl.value || "").trim();
  const recSel = document.getElementById(prefix + "Recurrence");
  if (!recSel) return;
  let recurrence = null;
  if (cat === "Mortgage/Rent" || cat === "Credit Card Payment" || cat === "Utility") {
    recurrence = "monthly";
  } else if (cat === "Paycheck") {
    recurrence = "biweekly";
  }
  if (recurrence != null) {
    recSel.value = recurrence;
    recSel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function initAccountSetupTransactionUi() {
  if (!isAccountSetupPath()) return;
  if (document.getElementById("accountSetupWizard")) {
    const swatches = document.getElementById("asTxColorSwatches");
    const bgEl = document.getElementById("asTxBgColor");
    const clearBtn = document.getElementById("asTxColorClear");
    if (swatches) {
      for (const btn of swatches.querySelectorAll("button.cat-swatch")) {
        const bg = String(btn.getAttribute("data-bg") || "").trim();
        if (bg) btn.style.background = bg;
        btn.addEventListener("click", () => {
          if (bgEl) bgEl.value = bg;
          for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
          btn.classList.add("is-active");
        });
      }
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (bgEl) bgEl.value = "";
        if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
      });
    }

    function bindScheduleUi(prefix) {
      const fields = getAccountSetupScheduleFields(prefix);
      if (fields.secondDayEl) populateAccountSetupSecondDayOptions(fields.secondDayEl);
      for (const el of [fields.recurrenceEl, fields.dateEl, fields.secondDayEl, fields.endsModeEl]) {
        el?.addEventListener("change", () => syncAccountSetupScheduleUi(prefix));
      }
      fields.endDateEl?.addEventListener("input", () => syncAccountSetupScheduleUi(prefix));
      fields.endCountEl?.addEventListener("input", () => syncAccountSetupScheduleUi(prefix));
      syncAccountSetupScheduleUi(prefix);
    }

    bindScheduleUi("asTx");
    bindScheduleUi("asExp");
    const txCat = document.getElementById("asTxCategory");
    const expCat = document.getElementById("asExpTxCategory");
    if (txCat) txCat.addEventListener("change", () => applyAccountSetupCategoryRecurrenceDefaults(txCat, "asTx"));
    if (expCat) expCat.addEventListener("change", () => applyAccountSetupCategoryRecurrenceDefaults(expCat, "asExp"));
    initAccountSetupCategoryCombobox("asTxCategory", "asTxCategorySearch", "asTxCategoryList");
    initAccountSetupCategoryCombobox("asExpTxCategory", "asExpTxCategorySearch", "asExpTxCategoryList");
    initAccountSetupQuickChips();
    const expSwatches = document.getElementById("asExpTxColorSwatches");
    const expBgEl = document.getElementById("asExpTxBgColor");
    const expClearBtn = document.getElementById("asExpTxColorClear");
    if (expSwatches) {
      for (const btn of expSwatches.querySelectorAll("button.cat-swatch")) {
        const bg = String(btn.getAttribute("data-bg") || "").trim();
        if (bg) btn.style.background = bg;
        btn.addEventListener("click", () => {
          if (expBgEl) expBgEl.value = bg;
          for (const b of expSwatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
          btn.classList.add("is-active");
        });
      }
    }
    if (expClearBtn) {
      expClearBtn.addEventListener("click", () => {
        if (expBgEl) expBgEl.value = "";
        if (expSwatches) for (const b of expSwatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
      });
    }
    setAccountSetupWizardStep(getAccountSetupWizardStep(), { skipPersist: true });
    return;
  }
  const swatches = document.getElementById("asTxColorSwatches");
  const bgEl = document.getElementById("asTxBgColor");
  const clearBtn = document.getElementById("asTxColorClear");
  if (swatches) {
    for (const btn of swatches.querySelectorAll("button.cat-swatch")) {
      const bg = String(btn.getAttribute("data-bg") || "").trim();
      if (bg) btn.style.background = bg;
      btn.addEventListener("click", () => {
        if (bgEl) bgEl.value = bg;
        for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
        btn.classList.add("is-active");
      });
    }
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (bgEl) bgEl.value = "";
      if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
    });
  }
  setAccountSetupStep(getAccountSetupStep());
}

try {
  initAccountSetupCardAccordion();
} catch (_) {}

