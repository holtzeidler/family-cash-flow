function getApiBase() {
  const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  return b.replace(/\/$/, "");
}

/** Cross-site cookie fallback (GitHub Pages → API); cleared on logout / 401. */
const BW_API_ACCESS_TOKEN_KEY = "bw_api_access_token";

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

function setCallout(el, msg, mode = "pending") {
  if (!el) return;
  el.textContent = msg || "";
  el.className = mode ? `callout callout--${mode}` : "callout";
  el.style.display = msg ? "block" : "none";
}

async function goApp() {
  try {
    const t = sessionStorage.getItem("bw_invite_token");
    if (!t || !String(t).trim()) {
      window.location.href = "/calendar";
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
      window.location.href = "/calendar";
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
      window.location.href = "/invite/?token=" + enc;
      return;
    }
    window.location.href = "/invite/?token=" + enc;
  } catch (_) {
    window.location.href = "/calendar";
  }
}

function messageFromFailure(resp, fallback) {
  if (resp.networkError) return `${resp.networkError}.`;
  if (resp.status === 409) return "Email already registered.";
  if (resp.status === 400 && resp.data && resp.data.detail) return resp.data.detail;
  if (resp.status >= 500) return `Server error (${resp.status}). Try again in 30–60s.`;
  if (resp.data && resp.data.detail) return resp.data.detail;
  return fallback;
}

async function verifySessionWithProgress(targetInfoEl) {
  const attempts = [0, 800, 1800, 3200];
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) await new Promise((resolve) => setTimeout(resolve, attempts[i]));
    setCallout(targetInfoEl, "Logging in....", "pending");
    const me = await request("/api/auth/me", "GET");
    if (me.ok && me.data && me.data.user) return { ok: true };
  }
  return { ok: false };
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
/** Bumped when step order changes; used to migrate persisted `wizardStep`. */
const ACCOUNT_SETUP_WIZARD_FLOW_VERSION = 3;
/** Logical wizard step (0–4) → `accountSetupWizardPanel{N}` — email, checking, income, expense, survey (last). */
const ACCOUNT_SETUP_PANEL_FOR_STEP = [0, 1, 2, 3, 4];
/** v2 order was email → survey → checking → income → expense (`wizardStep` index). Maps step → panel index. */
const V2_ACCOUNT_SETUP_PANEL_FOR_STEP = [0, 4, 1, 2, 3];

/** Progress UI shows 4 dots; expense (step 3) and survey (step 4) share the last dot. */
function getAccountSetupWizardDisplayDotIndex(step) {
  const s = Math.min(4, Math.max(0, step));
  return s >= 3 ? 3 : s;
}
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
  { group: "Income & reimbursements", value: "Paycheck", label: "Paycheck" },
  { group: "Income & reimbursements", value: "Reimbursement", label: "Reimbursement" },
  { group: "Home", value: "Mortgage/Rent", label: "Mortgage/Rent" },
  { group: "Home", value: "Home Maintenance", label: "Home Maintenance" },
  { group: "Home", value: "Utility", label: "Utility" },
  { group: "Loans & payments", value: "Car Loan", label: "Car Loan" },
  { group: "Loans & payments", value: "Credit Card Payment", label: "Credit Card Payment" },
  { group: "Transfers & investing", value: "Transfers", label: "Transfers" },
  { group: "Transfers & investing", value: "Investment", label: "Investment" },
  { group: "Transfers & investing", value: "Cash & ATM", label: "Cash & ATM" },
  { group: "Other", value: "Charity", label: "Charity" },
  { group: "Other", value: "Gifts", label: "Gifts" },
  { group: "Other", value: "Miscellaneous", label: "Miscellaneous" },
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

function filterCategoriesForSearch(query) {
  const q = query.trim();
  if (!q) return [...ACCOUNT_SETUP_CATEGORY_ITEMS];
  const scored = ACCOUNT_SETUP_CATEGORY_ITEMS.map((item) => ({
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
  if (hidden) hidden.value = "";
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
    hidden.value = item.value;
    input.value = item.label;
    list.hidden = true;
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function resolveInputOnBlur() {
    const raw = input.value.trim();
    if (!raw) {
      hidden.value = "";
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const ranked = filterCategoriesForSearch(raw);
    const exact = ACCOUNT_SETUP_CATEGORY_ITEMS.find(
      (i) => i.label.toLowerCase() === raw.toLowerCase() || i.value.toLowerCase() === raw.toLowerCase()
    );
    if (exact) {
      commit(exact);
      return;
    }
    if (ranked.length === 1) {
      commit(ranked[0]);
      return;
    }
    const cur = ACCOUNT_SETUP_CATEGORY_ITEMS.find((i) => i.value === hidden.value);
    if (cur && cur.label.trim() !== input.value.trim()) {
      hidden.value = "";
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function renderDropdown() {
    const q = input.value;
    const items = filterCategoriesForSearch(q);
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
    activeIdx = items.length ? 0 : -1;
    const opts = optionElements();
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
      const items = filterCategoriesForSearch(input.value);
      if (!list.hidden && items.length && activeIdx >= 0 && activeIdx < items.length) {
        e.preventDefault();
        commit(items[activeIdx]);
      }
    }
  });

  accountSetupSyncCategorySearchDisplay(hiddenId);
}

// Prefetch check-email during Step 0 so Enter→Next feels instant.
const BW_EMAIL_CHECK_CACHE_MS = 5 * 60 * 1000;
let bwEmailCheckCache = { email: "", checkedAt: 0, exists: null, pending: null };
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
  try {
    lockAccountSetupWizardStepTransition();
    setAccountSetupWizardStep(0);
    document.getElementById("email")?.focus();
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
    sessionStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, JSON.stringify(raw));
  } catch (_) {}
}

function setAccountSetupStep3Phase(phase) {
  const p2 = document.getElementById("accountSetupWizardPanel2");
  const intro = document.getElementById("accountSetupWizardStep3Intro");
  const form = document.getElementById("accountSetupWizardStep3Form");
  if (!p2 || !intro || !form) return;
  const isForm = phase === "form";
  p2.setAttribute("data-step3-phase", isForm ? "form" : "intro");
  intro.hidden = isForm;
  form.hidden = !isForm;
  const kt = document.getElementById("accountSetupKindToggle");
  if (kt) kt.classList.toggle("account-setup-kind-toggle--income-only", isForm);
  if (isForm) {
    const inc = document.querySelector('input[name="asTxKind"][value="income"]');
    if (inc) inc.checked = true;
  }
  persistDraftStep3Phase(isForm ? "form" : "intro");
  syncAccountSetupWizardShellButtons();
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
    sessionStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, JSON.stringify(raw));
  } catch (_) {}
}

function setAccountSetupExpensePhase(phase) {
  const p3 = document.getElementById("accountSetupWizardPanel3");
  const intro = document.getElementById("accountSetupWizardStep4Intro");
  const form = document.getElementById("accountSetupWizardStep4Form");
  if (!p3 || !form) return;
  const isForm = phase === "form";
  p3.setAttribute("data-expense-phase", isForm ? "form" : "intro");
  if (intro) intro.hidden = isForm;
  form.hidden = !isForm;
  const kt = document.getElementById("accountSetupExpenseKindToggle");
  if (kt) kt.classList.toggle("account-setup-kind-toggle--expense-only", isForm);
  if (isForm) {
    const ex = document.querySelector('input[name="asExpTxKind"][value="expense"]');
    if (ex) ex.checked = true;
  }
  persistDraftExpensePhase(isForm ? "form" : "intro");
  syncAccountSetupWizardShellButtons();
}

function syncAccountSetupWizardShellButtons() {
  const s = getAccountSetupWizardStep();
  const saveInc = document.getElementById("asTxSaveIncomeBtn");
  const cancelInc = document.getElementById("asTxCancelIncomeBtn");
  const saveExp = document.getElementById("asExpSaveBtn");
  const cancelExp = document.getElementById("asExpCancelBtn");
  const hubSkip = document.getElementById("asTxHubSkipBtn");
  const hubContinue = document.getElementById("asTxHubContinueBtn");
  const hubAddIncome = document.getElementById("asTxHubAddIncomeBtn");
  const hubAddExpense = document.getElementById("asTxHubAddExpenseBtn");
  if (!document.getElementById("accountSetupWizard")) return;

  for (const el of [saveInc, cancelInc, saveExp, cancelExp]) {
    if (el) el.style.display = "none";
  }
  if (addMoreTxBtn) addMoreTxBtn.style.display = "none";
  if (accountSetupSkipBtn) accountSetupSkipBtn.style.display = s === 1 ? "inline-flex" : "none";

  // Tx hub: show Continue once any transaction exists.
  try {
    if ((hubSkip || hubContinue) && s === 2 && getAccountSetupStep3Phase() === "intro") {
      const rawDraft = readAccountSetupDraftRaw() || {};
      const txs = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
      const hasTx = txs.length > 0;
      const hasIncome = txs.some((t) => String(t?.kind || "").toLowerCase() === "income");
      const hasExpense = txs.some((t) => String(t?.kind || "").toLowerCase() === "expense");
      if (hubSkip) hubSkip.hidden = !hasTx;
      hubContinue.hidden = !hasTx;
      if (hubAddIncome) hubAddIncome.disabled = hasIncome;
      if (hubAddExpense) hubAddExpense.disabled = hasExpense;
    } else {
      if (hubSkip) hubSkip.hidden = true;
      if (hubContinue) hubContinue.hidden = true;
      if (hubAddIncome) hubAddIncome.disabled = false;
      if (hubAddExpense) hubAddExpense.disabled = false;
    }
  } catch (_) {}

  if (s < 2) {
    if (signupBtn) {
      signupBtn.style.display = "";
      signupBtn.textContent = "Next";
    }
    return;
  }

  if (s === 2) {
    const phase = getAccountSetupStep3Phase();
    if (phase === "form") {
      if (saveInc) saveInc.style.display = "inline-flex";
      if (cancelInc) cancelInc.style.display = "inline-flex";
      if (signupBtn) signupBtn.style.display = "none";
    } else if (signupBtn) {
      signupBtn.style.display = "none";
    }
    return;
  }

  if (s === 3) {
    const phase = getAccountSetupExpensePhase();
    if (phase === "form") {
      if (saveExp) saveExp.style.display = "inline-flex";
      if (addExp) addExp.style.display = "inline-flex";
      if (cancelExp) cancelExp.style.display = "inline-flex";
      if (signupBtn) signupBtn.style.display = "none";
    } else if (signupBtn) {
      signupBtn.style.display = "none";
    }
    return;
  }

  if (s === 4) {
    if (signupBtn) {
      signupBtn.style.display = "";
      signupBtn.textContent = "Create Account";
    }
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
    sessionStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, JSON.stringify(raw));
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

  const displayDot = getAccountSetupWizardDisplayDotIndex(s);
  const dots = w.querySelectorAll("[data-wizard-dot]");
  for (const d of dots) {
    const si = parseInt(d.getAttribute("data-wizard-dot") || "0", 10);
    const on = si === displayDot;
    d.classList.toggle("is-active", on);
    if (on) {
      d.setAttribute("aria-current", "step");
      d.removeAttribute("aria-hidden");
    } else {
      d.removeAttribute("aria-current");
      d.setAttribute("aria-hidden", "true");
    }
  }

  if (accountSetupBackBtn) accountSetupBackBtn.style.display = s > 0 ? "inline-flex" : "none";
  if (addMoreTxBtn) addMoreTxBtn.style.display = "none";
  syncAccountSetupWizardShellButtons();

  if (!skipPersist) persistAccountSetupWizardMeta(s);

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
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

function canAdvanceAccountSetupAccountStep({ accountName, accountStartingBalanceRaw, accountStartingBalance, accountStartingBalanceDate }) {
  const anyAccount =
    !!accountName ||
    (accountStartingBalanceRaw != null && String(accountStartingBalanceRaw).trim() !== "") ||
    !!accountStartingBalanceDate;
  if (anyAccount) {
    if (!accountName) return { ok: false, message: "Account name is required (or leave the account section blank)." };
    if (accountStartingBalance == null) return { ok: false, message: "Starting balance is required (or leave the account section blank)." };
    if (!accountStartingBalanceDate) return { ok: false, message: "Starting balance date is required (or leave the account section blank)." };
  }
  return { ok: true, anyAccount };
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
    let existingDraft = null;
    try {
      existingDraft = JSON.parse(sessionStorage.getItem(BW_ACCOUNT_SETUP_DRAFT_KEY) || "null");
    } catch (_) {}
    const existingTransactions = Array.isArray(existingDraft?.transactions) ? existingDraft.transactions : [];

    const accountName = (document.getElementById("accountName")?.value || "").trim();
    const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
    const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
    const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
    const txKind = String(document.querySelector('input[name="asTxKind"]:checked')?.value || "").trim();
    const txAmountRaw = document.getElementById("asTxAmount")?.value || "";
    const txAmount = toMoneyNumber(txAmountRaw);
    const txCategory = (document.getElementById("asTxCategory")?.value || "").trim();
    const txDate = String(document.getElementById("asTxDate")?.value || "").trim();
    const txNotes = (document.getElementById("asTxNotes")?.value || "").trim();
    const txRecurring = !!document.getElementById("asTxRepeats")?.checked;
    const txRecurrence = String(document.getElementById("asTxRecurrence")?.value || "monthly").trim() || "monthly";
    const txEndDateRaw = String(document.getElementById("asTxEndDate")?.value || "").trim();
    const txEndCountRaw = String(document.getElementById("asTxEndCount")?.value || "").trim();
    const txEndCount = txEndCountRaw === "" ? null : Number(txEndCountRaw);
    const txBgColor = String(document.getElementById("asTxBgColor")?.value || "").trim();
    const anyAccount =
      !!accountName ||
      (accountStartingBalanceRaw != null && String(accountStartingBalanceRaw).trim() !== "") ||
      !!accountStartingBalanceDate;
    if (anyAccount) {
      if (!accountName) {
        setCallout(signupCalloutEl, "Account name is required (or leave the account section blank).", "error");
        return;
      }
      if (accountStartingBalance == null) {
        setCallout(signupCalloutEl, "Starting balance is required (or leave the account section blank).", "error");
        return;
      }
      if (!accountStartingBalanceDate) {
        setCallout(signupCalloutEl, "Starting balance date is required (or leave the account section blank).", "error");
        return;
      }
    }

    const anyTx =
      (txAmountRaw != null && String(txAmountRaw).trim() !== "") ||
      !!txCategory ||
      !!txDate ||
      !!txNotes ||
      txRecurring ||
      !!txBgColor;
    if (anyTx) {
      if (!txKind) {
        setCallout(signupCalloutEl, "Transaction type is required (or leave transactions blank).", "error");
        return;
      }
      if (txAmount == null || txAmount <= 0) {
        setCallout(signupCalloutEl, "Transaction amount is required (or leave transactions blank).", "error");
        return;
      }
      if (!txDate) {
        setCallout(signupCalloutEl, "Transaction date is required (or leave transactions blank).", "error");
        return;
      }
    }
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
        ...(anyAccount
          ? {
              account: {
                name: accountName,
                type: "checking",
                starting_balance: accountStartingBalance,
                starting_balance_date: accountStartingBalanceDate,
              },
            }
          : {}),
        ...(anyTx
          ? {
              transactions: [
                ...existingTransactions,
                {
                  kind: txKind,
                  amount: txAmount,
                  category: txCategory || "Uncategorized",
                  date: txDate,
                  notes: txNotes,
                  recurring: txRecurring,
                  recurrence: txRecurring ? txRecurrence : null,
                  end_date: txRecurring ? (txEndDateRaw !== "" ? txEndDateRaw : null) : null,
                  end_count: txRecurring ? (txEndDateRaw !== "" ? null : txEndCount) : null,
                  bg_color: txBgColor || null,
                },
              ],
            }
          : { transactions: existingTransactions }),
        step: "transactions",
      })
    );
  } catch (e) {
    setCallout(signupCalloutEl, (e && e.message) || "Could not continue.", "error");
    return;
  }
  const q = window.location.search || "";
  window.location.assign("/signup/" + q);
}

function readAccountSetupDraftRaw() {
  let raw = "";
  try {
    raw = sessionStorage.getItem(BW_ACCOUNT_SETUP_DRAFT_KEY) || "";
  } catch (_) {}
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function readAccountSetupTransactionFromInputs() {
  const txKind = String(document.querySelector('input[name="asTxKind"]:checked')?.value || "").trim();
  const txAmountRaw = document.getElementById("asTxAmount")?.value || "";
  const txAmount = toMoneyNumber(txAmountRaw);
  const txCategory = (document.getElementById("asTxCategory")?.value || "").trim();
  const txDate = String(document.getElementById("asTxDate")?.value || "").trim();
  const txNotes = (document.getElementById("asTxNotes")?.value || "").trim();
  const repeats = !!document.getElementById("asTxRepeats")?.checked;
  const recurrence = String(document.getElementById("asTxRecurrence")?.value || "monthly").trim() || "monthly";
  const endDate = String(document.getElementById("asTxEndDate")?.value || "").trim() || null;
  const endCountRaw = String(document.getElementById("asTxEndCount")?.value || "").trim();
  const endCount = endCountRaw === "" ? null : Number(endCountRaw);
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
  if (!txDate) return { ok: false, empty: false, tx: null, message: "Transaction date is required." };
  const categoryResolved = txCategory || "Uncategorized";
  if (repeats) {
    if (endCount != null) {
      if (!Number.isFinite(endCount) || endCount < 1 || Math.floor(endCount) !== endCount) {
        return { ok: false, empty: false, tx: null, message: "Ends after must be a whole number ≥ 1" };
      }
    }
    if (endDate != null && endDate !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return { ok: false, empty: false, tx: null, message: "Ends on must be a date" };
      }
      if (endDate < txDate) {
        return { ok: false, empty: false, tx: null, message: "Ends on cannot be before the start date" };
      }
    }
    if (endCount != null && endDate != null && endDate !== "") {
      return { ok: false, empty: false, tx: null, message: "Provide only one of Ends after or Ends on" };
    }
  }
  return {
    ok: true,
    empty: false,
    tx: {
      kind: txKind,
      amount: txAmount,
      category: categoryResolved,
      date: txDate,
      notes: txNotes,
      recurring: repeats,
      recurrence: repeats ? recurrence : null,
      end_date: repeats ? (endDate && endDate !== "" ? endDate : null) : null,
      end_count: repeats ? (endDate && endDate !== "" ? null : endCount) : null,
      bg_color: txBgColor || null,
    },
    message: "",
  };
}

function resetAccountSetupTransactionForm() {
  const amountEl = document.getElementById("asTxAmount");
  const dateEl = document.getElementById("asTxDate");
  const notesEl = document.getElementById("asTxNotes");
  const repeatsEl = document.getElementById("asTxRepeats");
  const recSel = document.getElementById("asTxRecurrence");
  const endCountEl = document.getElementById("asTxEndCount");
  const endDateEl = document.getElementById("asTxEndDate");
  const endCountWrap = document.getElementById("asTxEndCountWrap");
  const endDateWrap = document.getElementById("asTxEndDateWrap");
  const bgEl = document.getElementById("asTxBgColor");
  if (amountEl) amountEl.value = "";
  clearAccountSetupCategoryCombobox("asTxCategory");
  if (notesEl) notesEl.value = "";
  if (repeatsEl) repeatsEl.checked = false;
  if (recSel) recSel.value = "monthly";
  if (endCountEl) endCountEl.value = "";
  if (endDateEl) endDateEl.value = "";
  if (endCountWrap) endCountWrap.hidden = true;
  if (endDateWrap) endDateWrap.hidden = true;
  if (bgEl) bgEl.value = "";
  const swatches = document.getElementById("asTxColorSwatches");
  if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
  if (dateEl) dateEl.value = "";
  const formEl = document.getElementById("accountSetupWizardStep3Form");
  const incomeOnly = formEl && !formEl.hidden;
  const inc = document.querySelector('input[name="asTxKind"][value="income"]');
  const exp = document.querySelector('input[name="asTxKind"][value="expense"]');
  if (incomeOnly && inc) inc.checked = true;
  else if (exp) exp.checked = true;
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
  });
  if (!gate.ok) {
    setCallout(signupCalloutEl, gate.message, "error");
    setAccountSetupStep("account");
    return;
  }

  const parsed = readAccountSetupTransactionFromInputs();
  if (!parsed.ok) {
    if (!parsed.empty) setCallout(signupCalloutEl, parsed.message || "Please complete the transaction.", "error");
    return;
  }

  const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
  sessionStorage.setItem(
    BW_ACCOUNT_SETUP_DRAFT_KEY,
    JSON.stringify({
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
            },
          }
        : {}),
      transactions: [...existing, parsed.tx],
      step: "transactions",
    })
  );

  resetAccountSetupTransactionForm();
}

function accountSetupCancelIncomeClick() {
  if (!isAccountSetupPath()) return;
  setCallout(signupCalloutEl, "", "");
  setAccountSetupStep3Phase("intro");
  resetAccountSetupTransactionForm();
}

async function accountSetupSaveIncomeClick() {
  if (!isAccountSetupPath()) return;
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
  });
  if (!gate.ok) {
    setCallout(signupCalloutEl, gate.message, "error");
    setAccountSetupWizardStep(1);
    return;
  }
  const parsed = readAccountSetupTransactionFromInputs();
  if (!parsed.ok) {
    setCallout(signupCalloutEl, parsed.message || "Please complete the transaction.", "error");
    return;
  }
  const txs = [...existing, parsed.tx];
  try {
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
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
              },
            }
          : {}),
        transactions: txs,
      })
    );
  } catch (_) {}
  resetAccountSetupTransactionForm();
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupStep3Phase("intro");
  setCallout(signupCalloutEl, "Transaction saved. Add another or skip when you're ready.", "ok");
  try {
    signupCalloutEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (_) {}
  window.setTimeout(() => {
    try {
      if (signupCalloutEl && signupCalloutEl.classList.contains("callout--ok")) setCallout(signupCalloutEl, "", "");
    } catch (_) {}
  }, 6500);
  syncAccountSetupWizardShellButtons();
  document.getElementById("asTxHubAddIncomeBtn")?.focus();
}

function advanceAccountSetupWizardToExpenseForm() {
  const rawDraft = readAccountSetupDraftRaw() || {};
  try {
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 3,
        expensePhase: "form",
      })
    );
  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(3, { skipPersist: true });
  setAccountSetupExpensePhase("form");
  document.getElementById("asExpTxAmount")?.focus();
}

function accountSetupTxHubAddIncomeClick() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  if (getAccountSetupWizardStep() !== 2 || getAccountSetupStep3Phase() !== "intro") return;
  setCallout(signupCalloutEl, "", "");
  try {
    const rawDraft = readAccountSetupDraftRaw() || {};
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "form",
      })
    );
  } catch (_) {}
  setAccountSetupStep3Phase("form");
  document.getElementById("asTxAmount")?.focus();
}

function accountSetupTxHubAddExpenseClick() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  if (getAccountSetupWizardStep() !== 2 || getAccountSetupStep3Phase() !== "intro") return;
  setCallout(signupCalloutEl, "", "");
  try {
    const rawDraft = readAccountSetupDraftRaw() || {};
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 3,
        step3Phase: "intro",
        expensePhase: "form",
      })
    );
  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(3, { skipPersist: true });
  setAccountSetupExpensePhase("form");
  document.getElementById("asExpTxAmount")?.focus();
}

function accountSetupTxHubContinueClick() {
  if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
  if (isAccountSetupWizardStepLocked()) return;
  if (getAccountSetupWizardStep() !== 2 || getAccountSetupStep3Phase() !== "intro") return;
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
  const repeats = !!document.getElementById("asExpRepeats")?.checked;
  const recurrence = String(document.getElementById("asExpRecurrence")?.value || "monthly").trim() || "monthly";
  const endDate = String(document.getElementById("asExpEndDate")?.value || "").trim() || null;
  const endCountRaw = String(document.getElementById("asExpEndCount")?.value || "").trim();
  const endCount = endCountRaw === "" ? null : Number(endCountRaw);
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
  if (!txDate) return { ok: false, empty: false, tx: null, message: "Transaction date is required." };
  const categoryResolved = txCategory || "Uncategorized";
  if (repeats) {
    if (endCount != null) {
      if (!Number.isFinite(endCount) || endCount < 1 || Math.floor(endCount) !== endCount) {
        return { ok: false, empty: false, tx: null, message: "Ends after must be a whole number ≥ 1" };
      }
    }
    if (endDate != null && endDate !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return { ok: false, empty: false, tx: null, message: "Ends on must be a date" };
      }
      if (endDate < txDate) {
        return { ok: false, empty: false, tx: null, message: "Ends on cannot be before the start date" };
      }
    }
    if (endCount != null && endDate != null && endDate !== "") {
      return { ok: false, empty: false, tx: null, message: "Provide only one of Ends after or Ends on" };
    }
  }
  return {
    ok: true,
    empty: false,
    tx: {
      kind: txKind,
      amount: txAmount,
      category: categoryResolved,
      date: txDate,
      notes: txNotes,
      recurring: repeats,
      recurrence: repeats ? recurrence : null,
      end_date: repeats ? (endDate && endDate !== "" ? endDate : null) : null,
      end_count: repeats ? (endDate && endDate !== "" ? null : endCount) : null,
      bg_color: txBgColor || null,
    },
    message: "",
  };
}

function resetAccountSetupExpenseForm() {
  const amountEl = document.getElementById("asExpTxAmount");
  const dateEl = document.getElementById("asExpTxDate");
  const notesEl = document.getElementById("asExpTxNotes");
  const repeatsEl = document.getElementById("asExpRepeats");
  const recSel = document.getElementById("asExpRecurrence");
  const endCountEl = document.getElementById("asExpEndCount");
  const endDateEl = document.getElementById("asExpEndDate");
  const endCountWrap = document.getElementById("asExpEndCountWrap");
  const endDateWrap = document.getElementById("asExpEndDateWrap");
  const bgEl = document.getElementById("asExpTxBgColor");
  if (amountEl) amountEl.value = "";
  clearAccountSetupCategoryCombobox("asExpTxCategory");
  if (notesEl) notesEl.value = "";
  if (repeatsEl) repeatsEl.checked = false;
  if (recSel) recSel.value = "monthly";
  if (endCountEl) endCountEl.value = "";
  if (endDateEl) endDateEl.value = "";
  if (endCountWrap) endCountWrap.hidden = true;
  if (endDateWrap) endDateWrap.hidden = true;
  if (bgEl) bgEl.value = "";
  const swatches = document.getElementById("asExpTxColorSwatches");
  if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
  if (dateEl) dateEl.value = "";
  const ex = document.querySelector('input[name="asExpTxKind"][value="expense"]');
  if (ex) ex.checked = true;
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
  });
  if (!gate.ok) {
    setCallout(signupCalloutEl, gate.message, "error");
    setAccountSetupWizardStep(1);
    return;
  }
  const parsed = readAccountSetupExpenseTransactionFromInputs();
  if (!parsed.ok) {
    if (!parsed.empty) setCallout(signupCalloutEl, parsed.message || "Please complete the transaction.", "error");
    return;
  }
  const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
  sessionStorage.setItem(
    BW_ACCOUNT_SETUP_DRAFT_KEY,
    JSON.stringify({
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
            },
          }
        : {}),
      transactions: [...existing, parsed.tx],
      step: "transactions",
    })
  );
  resetAccountSetupExpenseForm();
}

function accountSetupCancelExpenseClick() {
  if (!isAccountSetupPath()) return;
  setCallout(signupCalloutEl, "", "");
  resetAccountSetupExpenseForm();
  try {
    const rawDraft = readAccountSetupDraftRaw() || {};
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
        ...rawDraft,
        wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
        wizardStep: 2,
        step3Phase: "intro",
        expensePhase: "intro",
      })
    );
  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupExpensePhase("intro");
  setAccountSetupStep3Phase("intro");
  document.getElementById("asTxHubAddIncomeBtn")?.focus();
}

async function accountSetupSaveExpenseClick() {
  if (!isAccountSetupPath()) return;
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
  });
  if (!gate.ok) {
    setCallout(signupCalloutEl, gate.message, "error");
    setAccountSetupWizardStep(1);
    return;
  }
  const parsed = readAccountSetupExpenseTransactionFromInputs();
  if (!parsed.ok) {
    setCallout(signupCalloutEl, parsed.message || "Please complete the transaction.", "error");
    return;
  }
  const txs = [...existing, parsed.tx];
  try {
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
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
              },
            }
          : {}),
        transactions: txs,
      })
    );
  } catch (_) {}
  resetAccountSetupExpenseForm();
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupStep3Phase("intro");
  setAccountSetupExpensePhase("intro");
  setCallout(signupCalloutEl, "Transaction saved. Add another or skip when you're ready.", "ok");
  try {
    signupCalloutEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (_) {}
  window.setTimeout(() => {
    try {
      if (signupCalloutEl && signupCalloutEl.classList.contains("callout--ok")) setCallout(signupCalloutEl, "", "");
    } catch (_) {}
  }, 6500);
  syncAccountSetupWizardShellButtons();
  document.getElementById("asTxHubAddIncomeBtn")?.focus();
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
  let raw = "";
  try {
    raw = sessionStorage.getItem(BW_ACCOUNT_SETUP_DRAFT_KEY) || "";
  } catch (_) {}
  if (!raw) return;
  try {
    const o = JSON.parse(raw);
    const tzEl = document.getElementById("timeZone");
    const accNameEl = document.getElementById("accountName");
    const accBalEl = document.getElementById("accountStartingBalance");
    const accDateEl = document.getElementById("accountStartingBalanceDate");
    const txAmountEl = document.getElementById("asTxAmount");
    const txCategoryEl = document.getElementById("asTxCategory");
    const txDateEl = document.getElementById("asTxDate");
    const txNotesEl = document.getElementById("asTxNotes");
    const txRecurringEl = document.getElementById("asTxRepeats");
    const txRecSelEl = document.getElementById("asTxRecurrence");
    const txEndDateEl = document.getElementById("asTxEndDate");
    const txEndCountEl = document.getElementById("asTxEndCount");
    const txEndDateWrapEl = document.getElementById("asTxEndDateWrap");
    const txEndCountWrapEl = document.getElementById("asTxEndCountWrap");
    const txBgColorEl = document.getElementById("asTxBgColor");
    if (tzEl && o.timeZone) tzEl.value = String(o.timeZone);
    if (o.account) {
      if (accNameEl && o.account.name) accNameEl.value = String(o.account.name);
      if (accBalEl && o.account.starting_balance != null) accBalEl.value = String(o.account.starting_balance);
      if (accDateEl && o.account.starting_balance_date) accDateEl.value = String(o.account.starting_balance_date);
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
        const eRec = document.getElementById("asExpRepeats");
        const eRecSel = document.getElementById("asExpRecurrence");
        const eEndDate = document.getElementById("asExpEndDate");
        const eEndCount = document.getElementById("asExpEndCount");
        const eEndDateWrap = document.getElementById("asExpEndDateWrap");
        const eEndCountWrap = document.getElementById("asExpEndCountWrap");
        const eBg = document.getElementById("asExpTxBgColor");
        if (eAmt && lastTx.amount != null) eAmt.value = String(lastTx.amount);
        if (eCat && lastTx.category) {
          const c = String(lastTx.category).trim();
          eCat.value = c === "Uncategorized" ? "" : c;
          accountSetupSyncCategorySearchDisplay("asExpTxCategory");
        }
        if (eDate && lastTx.date) eDate.value = String(lastTx.date);
        if (eNotes && lastTx.notes) eNotes.value = String(lastTx.notes);
        if (eRec) eRec.checked = !!lastTx.recurring;
        const eOn = !!lastTx.recurring;
        if (eRecSel && lastTx.recurrence) eRecSel.value = String(lastTx.recurrence);
        if (eRecSel) eRecSel.disabled = !eOn;
        if (eEndDateWrap) eEndDateWrap.hidden = !eOn;
        if (eEndCountWrap) eEndCountWrap.hidden = !eOn;
        if (eEndDate && lastTx.end_date) eEndDate.value = String(lastTx.end_date);
        if (eEndCount && lastTx.end_count != null) eEndCount.value = String(lastTx.end_count);
        if (eBg && lastTx.bg_color) eBg.value = String(lastTx.bg_color);
      } else {
        const kindEl = k ? document.querySelector(`input[name="asTxKind"][value="${k}"]`) : null;
        if (kindEl) kindEl.checked = true;
        if (txAmountEl && lastTx.amount != null) txAmountEl.value = String(lastTx.amount);
        if (txCategoryEl && lastTx.category) {
          const c = String(lastTx.category).trim();
          txCategoryEl.value = c === "Uncategorized" ? "" : c;
          accountSetupSyncCategorySearchDisplay("asTxCategory");
        }
        if (txDateEl && lastTx.date) txDateEl.value = String(lastTx.date);
        if (txNotesEl && lastTx.notes) txNotesEl.value = String(lastTx.notes);
        if (txRecurringEl) txRecurringEl.checked = !!lastTx.recurring;
        const on = !!lastTx.recurring;
        if (txRecSelEl && lastTx.recurrence) txRecSelEl.value = String(lastTx.recurrence);
        if (txRecSelEl) txRecSelEl.disabled = !on;
        if (txEndDateWrapEl) txEndDateWrapEl.hidden = !on;
        if (txEndCountWrapEl) txEndCountWrapEl.hidden = !on;
        if (txEndDateEl && lastTx.end_date) txEndDateEl.value = String(lastTx.end_date);
        if (txEndCountEl && lastTx.end_count != null) txEndCountEl.value = String(lastTx.end_count);
        if (txBgColorEl && lastTx.bg_color) txBgColorEl.value = String(lastTx.bg_color);
      }
    }
    // Transaction "Next Date" fields stay blank until the user sets them (see reset/hydrate paths).

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
        const wantForm =
          String(o.step3Phase || "") === "form" ||
          (Array.isArray(o.transactions) && o.transactions.length > 0);
        if (wantForm) setAccountSetupStep3Phase("form");
        else syncAccountSetupWizardShellButtons();
      }
      if (target === 3 && document.getElementById("accountSetupWizardPanel3")) {
        const wantExpenseForm =
          String(o.expensePhase || "") === "form" ||
          (Array.isArray(o.transactions) &&
            o.transactions.length > 0 &&
            String(o.transactions[o.transactions.length - 1]?.kind || "").toLowerCase() === "expense");
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
    "asTxHubSkipBtn",
    "asTxHubContinueBtn",
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = isBusy;
  }
  if (isAccountSetupPath()) return;
  signupBtn.textContent = isBusy ? "Creating..." : "Create Account";
}

function readAccountSetupDraft() {
  let raw = "";
  try {
    raw = sessionStorage.getItem(BW_ACCOUNT_SETUP_DRAFT_KEY) || "";
  } catch (_) {}
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const account =
      o && o.account && o.account.name && o.account.starting_balance_date != null
        ? {
            name: String(o.account.name),
            type: String(o.account.type || "checking"),
            starting_balance: Number(o.account.starting_balance ?? 0),
            starting_balance_date: String(o.account.starting_balance_date),
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
        recurring: !!t?.recurring,
        recurrence: t?.recurrence != null && String(t.recurrence).trim() !== "" ? String(t.recurrence) : null,
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

async function maybeCreateFirstAccountFromDraft(draft) {
  try {
    if (!draft || !draft.account) return;
    const fams = await request("/api/families", "GET");
    if (!fams.ok || !Array.isArray(fams.data) || fams.data.length === 0) return;
    const familyId = fams.data[0]?.id;
    if (!familyId) return;
    const a = draft.account;
    const created = await request(`/api/families/${encodeURIComponent(String(familyId))}/accounts`, "POST", {
      name: a.name,
      type: a.type,
      starting_balance: a.starting_balance,
      starting_balance_date: a.starting_balance_date,
    });
    if (created && created.ok && created.data && created.data.id) return Number(created.data.id);
  } catch (_) {}
}

async function maybeCreateFirstTransactionFromDraft(draft, createdAccountId) {
  try {
    if (!draft) return;
    const fams = await request("/api/families", "GET");
    if (!fams.ok || !Array.isArray(fams.data) || fams.data.length === 0) return;
    const familyId = fams.data[0]?.id;
    if (!familyId) return;
    const list = Array.isArray(draft.transactions) ? draft.transactions : [];
    for (const t of list) {
      const description = (t.category || "").trim() || "Transaction";
      const amount = Number(t.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (t.recurring) {
        const accountId = Number(createdAccountId);
        if (!Number.isFinite(accountId) || accountId <= 0) continue;
        await request(`/api/families/${encodeURIComponent(String(familyId))}/expected-transactions`, "POST", {
          account_id: accountId,
          start_date: t.date,
          end_date: t.end_date || null,
          end_count: t.end_date ? null : t.end_count ?? null,
          recurrence: t.recurrence || "monthly",
          second_day_of_month: null,
          description,
          notes: t.notes ? t.notes : null,
          kind: t.kind,
          amount,
          variable: false,
          category_id: null,
          bg_color: t.bg_color ? t.bg_color : null,
          fg_color: null,
        });
      } else {
        await request(`/api/families/${encodeURIComponent(String(familyId))}/transactions`, "POST", {
          date: t.date,
          description,
          notes: t.notes ? t.notes : null,
          kind: t.kind,
          amount,
          category_id: null,
          fg_color: null,
          bg_color: t.bg_color ? t.bg_color : null,
          reimbursable: false,
        });
      }
    }
  } catch (_) {}
}

async function doSignup() {
  if (!signupBtn) return;
  setBusy(true);
  setCallout(signupCalloutEl, "Creating your account...", "pending");
  try {
    try {
      sessionStorage.removeItem(BW_API_ACCESS_TOKEN_KEY);
    } catch (_) {}
    const draft = readAccountSetupDraft();
    if (!draft) {
      setCallout(signupCalloutEl, "Please complete account setup first.", "error");
      const q = window.location.search || "";
      window.location.assign("/account-setup" + q);
      return;
    }
    const email = (document.getElementById("email")?.value || "").trim();
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

    const reg = await request("/api/auth/register", "POST", { name, email, password });
    if (!reg.ok) {
      setCallout(signupCalloutEl, messageFromFailure(reg, "Signup failed."), "error");
      return;
    }
    try {
      const tok = reg.data && reg.data.access_token != null ? String(reg.data.access_token).trim() : "";
      if (tok) sessionStorage.setItem(BW_API_ACCESS_TOKEN_KEY, tok);
    } catch (_) {}

    const check = await verifySessionWithProgress(signupCalloutEl);
    if (!check.ok) {
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
    const createdAccountId = await maybeCreateFirstAccountFromDraft(draft);
    await maybeCreateFirstTransactionFromDraft(draft, createdAccountId);

    try {
      sessionStorage.removeItem(BW_ACCOUNT_SETUP_DRAFT_KEY);
    } catch (_) {}

    setCallout(signupCalloutEl, "", "");
    await goApp();
  } catch (e) {
    setCallout(signupCalloutEl, (e && e.message) || "Signup failed.", "error");
  } finally {
    setBusy(false);
  }
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
      if (params.get("fresh") === "1") sessionStorage.removeItem(BW_ACCOUNT_SETUP_DRAFT_KEY);
    } catch (_) {}
    scheduleAuthApiWarmup();
  }
  hydrateAccountSetupDraft();
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
        setCallout(signupCalloutEl, "Checking email…", "pending");
        const p = precheckEmailExists(email);
        lockAccountSetupWizardStepTransition();
        setAccountSetupWizardStep(1);
        document.getElementById("accountName")?.focus();
        Promise.resolve(p)
          .then((cached) => {
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
        });
        if (!gate.ok) {
          setCallout(signupCalloutEl, gate.message, "error");
          return;
        }
        try {
          const rawDraft = readAccountSetupDraftRaw() || {};
          sessionStorage.setItem(
            BW_ACCOUNT_SETUP_DRAFT_KEY,
            JSON.stringify({
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
                    },
                  }
                : {}),
            })
          );
        } catch (_) {}
        lockAccountSetupWizardStepTransition();
        setAccountSetupWizardStep(2, { skipPersist: true });
        setAccountSetupStep3Phase("intro");
        document.getElementById("asTxHubAddIncomeBtn")?.focus();
        return;
      }
      if (st === 2) {
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
          sessionStorage.setItem(
            BW_ACCOUNT_SETUP_DRAFT_KEY,
            JSON.stringify({
              ...rawDraft,
              wizardFlowVersion: ACCOUNT_SETUP_WIZARD_FLOW_VERSION,
              wizardStep: 4,
              surveyHelpWith: selected,
              surveyOther: selected.includes("other") ? otherVal : "",
            })
          );
        } catch (_) {}
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
        });
        if (!gate.ok) {
          setCallout(signupCalloutEl, gate.message, "error");
          setAccountSetupStep("account");
          return;
        }
        sessionStorage.setItem(
          BW_ACCOUNT_SETUP_DRAFT_KEY,
          JSON.stringify({
            ...(gate.anyAccount
              ? {
                  account: {
                    name: accountName,
                    type: "checking",
                    starting_balance: accountStartingBalance,
                    starting_balance_date: accountStartingBalanceDate,
                  },
                }
              : {}),
            step: "transactions",
          })
        );
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
  if (getAccountSetupWizardStep() !== 1) return;
  setCallout(signupCalloutEl, "", "");
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
    sessionStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, JSON.stringify(next));
  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(2, { skipPersist: true });
  setAccountSetupStep3Phase("intro");
  document.getElementById("asTxHubAddIncomeBtn")?.focus();
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
if (addMoreTxBtn) addMoreTxBtn.addEventListener("click", addMoreTransactionsFromAccountSetup);
document.getElementById("asTxSaveIncomeBtn")?.addEventListener("click", () => void accountSetupSaveIncomeClick());
document.getElementById("asTxCancelIncomeBtn")?.addEventListener("click", () => accountSetupCancelIncomeClick());
document.getElementById("asTxHubAddIncomeBtn")?.addEventListener("click", () => accountSetupTxHubAddIncomeClick());
document.getElementById("asTxHubAddExpenseBtn")?.addEventListener("click", () => accountSetupTxHubAddExpenseClick());
document.getElementById("asTxHubSkipBtn")?.addEventListener("click", () => accountSetupTxHubContinueClick());
document.getElementById("asTxHubContinueBtn")?.addEventListener("click", () => accountSetupTxHubContinueClick());
document.getElementById("asExpSaveBtn")?.addEventListener("click", () => void accountSetupSaveExpenseClick());
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
if (accountSetupBackBtn) {
  accountSetupBackBtn.addEventListener("click", () => {
    if (!isAccountSetupPath() || !document.getElementById("accountSetupWizard")) return;
    const s = getAccountSetupWizardStep();
    if (s <= 0) return;
    setCallout(signupCalloutEl, "", "");
    if (s === 2 && getAccountSetupStep3Phase() === "form") {
      accountSetupCancelIncomeClick();
      return;
    }
    if (s === 3 && getAccountSetupExpensePhase() === "form") {
      accountSetupCancelExpenseClick();
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
  });
}

/** When category implies a typical cadence, enable Repeats and set recurrence (account setup wizard). */
function applyAccountSetupCategoryRecurrenceDefaults(categoryEl, prefix) {
  if (!categoryEl) return;
  const cat = String(categoryEl.value || "").trim();
  const repeatsEl = document.getElementById(prefix + "Repeats");
  const recSel = document.getElementById(prefix + "Recurrence");
  if (!repeatsEl || !recSel) return;
  let recurrence = null;
  if (cat === "Mortgage/Rent" || cat === "Credit Card Payment" || cat === "Utility") {
    repeatsEl.checked = true;
    recurrence = "monthly";
  } else if (cat === "Paycheck") {
    repeatsEl.checked = true;
    recurrence = "biweekly";
  }
  if (recurrence != null) {
    recSel.value = recurrence;
    repeatsEl.dispatchEvent(new Event("change", { bubbles: true }));
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

    function bindRepeatsUi(prefix) {
      const repeatsEl = document.getElementById(prefix + "Repeats");
      const recSel = document.getElementById(prefix + "Recurrence");
      const endCountWrap = document.getElementById(prefix + "EndCountWrap");
      const endCountEl = document.getElementById(prefix + "EndCount");
      const endDateWrap = document.getElementById(prefix + "EndDateWrap");
      const endDateEl = document.getElementById(prefix + "EndDate");
      if (!repeatsEl) return;

      const update = () => {
        const on = !!repeatsEl.checked;
        if (recSel) recSel.disabled = !on;
        if (endCountWrap) endCountWrap.hidden = !on;
        if (endDateWrap) endDateWrap.hidden = !on;
        if (endCountEl) {
          if (!on) endCountEl.value = "";
          endCountEl.disabled = !on;
        }
        if (endDateEl) {
          if (!on) endDateEl.value = "";
          endDateEl.disabled = !on;
        }
      };

      repeatsEl.addEventListener("change", update);
      update();

      if (endCountEl && endDateEl) {
        endCountEl.addEventListener("input", () => {
          if (String(endCountEl.value || "").trim()) endDateEl.value = "";
        });
        endDateEl.addEventListener("input", () => {
          if (String(endDateEl.value || "").trim()) endCountEl.value = "";
        });
      }
    }

    bindRepeatsUi("asTx");
    bindRepeatsUi("asExp");
    const txCat = document.getElementById("asTxCategory");
    const expCat = document.getElementById("asExpTxCategory");
    if (txCat) txCat.addEventListener("change", () => applyAccountSetupCategoryRecurrenceDefaults(txCat, "asTx"));
    if (expCat) expCat.addEventListener("change", () => applyAccountSetupCategoryRecurrenceDefaults(expCat, "asExp"));
    initAccountSetupCategoryCombobox("asTxCategory", "asTxCategorySearch", "asTxCategoryList");
    initAccountSetupCategoryCombobox("asExpTxCategory", "asExpTxCategorySearch", "asExpTxCategoryList");
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

