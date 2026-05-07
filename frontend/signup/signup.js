function getApiBase() {
  const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  return b.replace(/\/$/, "");
}

async function request(path, method, body) {
  const apiBase = getApiBase();
  const fullPath = `${apiBase}${path}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(fullPath, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
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

const BW_ACCOUNT_SETUP_DRAFT_KEY = "bw_account_setup_draft";

function openAccountSetupDuplicateEmailModal() {
  const el = document.getElementById("accountSetupDuplicateEmailModal");
  if (!el) return;
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
 * A double-click on "Next" from step 0 would otherwise run step 1 with empty
 * account fields — which is valid — and skip straight to step 2.
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
  if (!p3 || !intro || !form) return;
  const isForm = phase === "form";
  p3.setAttribute("data-expense-phase", isForm ? "form" : "intro");
  intro.hidden = isForm;
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
  const addMoreInc = document.getElementById("asTxAddMoreIncomeBtn");
  const cancelInc = document.getElementById("asTxCancelIncomeBtn");
  const saveExp = document.getElementById("asExpSaveBtn");
  const addExp = document.getElementById("asExpAddMoreBtn");
  const cancelExp = document.getElementById("asExpCancelBtn");
  if (!document.getElementById("accountSetupWizard")) return;

  for (const el of [saveInc, addMoreInc, cancelInc, saveExp, addExp, cancelExp]) {
    if (el) el.style.display = "none";
  }
  if (addMoreTxBtn) addMoreTxBtn.style.display = "none";

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
      if (addMoreInc) addMoreInc.style.display = "inline-flex";
      if (cancelInc) cancelInc.style.display = "inline-flex";
      if (signupBtn) signupBtn.style.display = "none";
    } else {
      if (signupBtn) {
        signupBtn.style.display = "inline-flex";
        signupBtn.textContent = "Continue";
      }
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
    } else {
      if (signupBtn) {
        signupBtn.style.display = "inline-flex";
        signupBtn.textContent = "Continue";
      }
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
  return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0;
}

function persistAccountSetupWizardMeta(stepIndex) {
  try {
    const prev = readAccountSetupDraftRaw();
    const raw = prev && typeof prev === "object" && !Array.isArray(prev) ? { ...prev } : {};
    raw.wizardStep = stepIndex;
    sessionStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, JSON.stringify(raw));
  } catch (_) {}
}

function setAccountSetupWizardStep(step, opts = {}) {
  const skipPersist = !!opts.skipPersist;
  const w = document.getElementById("accountSetupWizard");
  const track = document.getElementById("accountSetupWizardTrack");
  if (!w || !track) return;
  const s = Math.min(3, Math.max(0, step));
  w.dataset.step = String(s);
  /* Show one panel at a time (avoid translateX(%): % is vs. track width and can misalign panels). */
  if (track.style.transform) track.style.removeProperty("transform");

  for (let i = 0; i < 4; i++) {
    const p = document.getElementById(`accountSetupWizardPanel${i}`);
    if (!p) continue;
    const active = i === s;
    p.classList.toggle("account-setup-wizard__panel--active", active);
    p.setAttribute("aria-hidden", active ? "false" : "true");
    if (active) p.removeAttribute("inert");
    else p.setAttribute("inert", "");
  }

  const dots = w.querySelectorAll("[data-wizard-dot]");
  for (const d of dots) {
    const si = parseInt(d.getAttribute("data-wizard-dot") || "0", 10);
    const on = si === s;
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
  if (signupBtn) {
    if (s === 2 || s === 3) syncAccountSetupWizardShellButtons();
    else signupBtn.textContent = "Next";
  }

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
    if (step === "transactions") setAccountSetupWizardStep(3);
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
    const txRecurring = !!document.getElementById("asTxRecurring")?.checked;
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
                  category: txCategory,
                  date: txDate,
                  notes: txNotes,
                  recurring: txRecurring,
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
  const txRecurring = !!document.getElementById("asTxRecurring")?.checked;
  const txBgColor = String(document.getElementById("asTxBgColor")?.value || "").trim();
  const anyTx =
    (txAmountRaw != null && String(txAmountRaw).trim() !== "") ||
    !!txCategory ||
    !!txDate ||
    !!txNotes ||
    txRecurring ||
    !!txBgColor;
  if (!anyTx) return { ok: false, empty: true, tx: null, message: "" };
  if (!txKind) return { ok: false, empty: false, tx: null, message: "Transaction type is required." };
  if (txAmount == null || txAmount <= 0) return { ok: false, empty: false, tx: null, message: "Transaction amount is required." };
  if (!txDate) return { ok: false, empty: false, tx: null, message: "Transaction date is required." };
  return {
    ok: true,
    empty: false,
    tx: {
      kind: txKind,
      amount: txAmount,
      category: txCategory,
      date: txDate,
      notes: txNotes,
      recurring: txRecurring,
      bg_color: txBgColor || null,
    },
    message: "",
  };
}

function resetAccountSetupTransactionForm() {
  const amountEl = document.getElementById("asTxAmount");
  const categoryEl = document.getElementById("asTxCategory");
  const dateEl = document.getElementById("asTxDate");
  const notesEl = document.getElementById("asTxNotes");
  const recurringEl = document.getElementById("asTxRecurring");
  const bgEl = document.getElementById("asTxBgColor");
  if (amountEl) amountEl.value = "";
  if (categoryEl) categoryEl.value = "";
  if (notesEl) notesEl.value = "";
  if (recurringEl) recurringEl.checked = false;
  if (bgEl) bgEl.value = "";
  const swatches = document.getElementById("asTxColorSwatches");
  if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
  if (dateEl) dateEl.value = isoTodayLocal();
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
  for (const r of document.querySelectorAll('input[name="asRecurringIncomePref"]')) {
    r.checked = false;
  }
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
        transactions: txs,
      })
    );
  } catch (_) {}
  advanceAccountSetupWizardToExpenseIntro();
}

function advanceAccountSetupWizardToExpenseIntro() {
  const rawDraft = readAccountSetupDraftRaw() || {};
  try {
    sessionStorage.setItem(
      BW_ACCOUNT_SETUP_DRAFT_KEY,
      JSON.stringify({
        ...rawDraft,
        wizardStep: 3,
        expensePhase: "intro",
      })
    );
  } catch (_) {}
  lockAccountSetupWizardStepTransition();
  setAccountSetupWizardStep(3, { skipPersist: true });
  setAccountSetupExpensePhase("intro");
  document.querySelector('input[name="asRecurringExpensePref"]')?.focus();
}

function readAccountSetupExpenseTransactionFromInputs() {
  const txKind = String(document.querySelector('input[name="asExpTxKind"]:checked')?.value || "").trim();
  const txAmountRaw = document.getElementById("asExpTxAmount")?.value || "";
  const txAmount = toMoneyNumber(txAmountRaw);
  const txCategory = (document.getElementById("asExpTxCategory")?.value || "").trim();
  const txDate = String(document.getElementById("asExpTxDate")?.value || "").trim();
  const txNotes = (document.getElementById("asExpTxNotes")?.value || "").trim();
  const txRecurring = !!document.getElementById("asExpTxRecurring")?.checked;
  const txBgColor = String(document.getElementById("asExpTxBgColor")?.value || "").trim();
  const anyTx =
    (txAmountRaw != null && String(txAmountRaw).trim() !== "") ||
    !!txCategory ||
    !!txDate ||
    !!txNotes ||
    txRecurring ||
    !!txBgColor;
  if (!anyTx) return { ok: false, empty: true, tx: null, message: "" };
  if (!txKind) return { ok: false, empty: false, tx: null, message: "Transaction type is required." };
  if (txAmount == null || txAmount <= 0) return { ok: false, empty: false, tx: null, message: "Transaction amount is required." };
  if (!txDate) return { ok: false, empty: false, tx: null, message: "Transaction date is required." };
  return {
    ok: true,
    empty: false,
    tx: {
      kind: txKind,
      amount: txAmount,
      category: txCategory,
      date: txDate,
      notes: txNotes,
      recurring: txRecurring,
      bg_color: txBgColor || null,
    },
    message: "",
  };
}

function resetAccountSetupExpenseForm() {
  const amountEl = document.getElementById("asExpTxAmount");
  const categoryEl = document.getElementById("asExpTxCategory");
  const dateEl = document.getElementById("asExpTxDate");
  const notesEl = document.getElementById("asExpTxNotes");
  const recurringEl = document.getElementById("asExpTxRecurring");
  const bgEl = document.getElementById("asExpTxBgColor");
  if (amountEl) amountEl.value = "";
  if (categoryEl) categoryEl.value = "";
  if (notesEl) notesEl.value = "";
  if (recurringEl) recurringEl.checked = false;
  if (bgEl) bgEl.value = "";
  const swatches = document.getElementById("asExpTxColorSwatches");
  if (swatches) for (const b of swatches.querySelectorAll("button.cat-swatch")) b.classList.remove("is-active");
  if (dateEl) dateEl.value = isoTodayLocal();
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
  for (const r of document.querySelectorAll('input[name="asRecurringExpensePref"]')) {
    r.checked = false;
  }
  setAccountSetupExpensePhase("intro");
  resetAccountSetupExpenseForm();
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
        transactions: txs,
      })
    );
  } catch (_) {}
  void doSignup();
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
    const txRecurringEl = document.getElementById("asTxRecurring");
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
        const eRec = document.getElementById("asExpTxRecurring");
        const eBg = document.getElementById("asExpTxBgColor");
        if (eAmt && lastTx.amount != null) eAmt.value = String(lastTx.amount);
        if (eCat && lastTx.category) eCat.value = String(lastTx.category);
        if (eDate && lastTx.date) eDate.value = String(lastTx.date);
        if (eNotes && lastTx.notes) eNotes.value = String(lastTx.notes);
        if (eRec) eRec.checked = !!lastTx.recurring;
        if (eBg && lastTx.bg_color) eBg.value = String(lastTx.bg_color);
      } else {
        const kindEl = k ? document.querySelector(`input[name="asTxKind"][value="${k}"]`) : null;
        if (kindEl) kindEl.checked = true;
        if (txAmountEl && lastTx.amount != null) txAmountEl.value = String(lastTx.amount);
        if (txCategoryEl && lastTx.category) txCategoryEl.value = String(lastTx.category);
        if (txDateEl && lastTx.date) txDateEl.value = String(lastTx.date);
        if (txNotesEl && lastTx.notes) txNotesEl.value = String(lastTx.notes);
        if (txRecurringEl) txRecurringEl.checked = !!lastTx.recurring;
        if (txBgColorEl && lastTx.bg_color) txBgColorEl.value = String(lastTx.bg_color);
      }
    }
    if (txDateEl && !txDateEl.value) txDateEl.value = isoTodayLocal();
    const expDateEl = document.getElementById("asExpTxDate");
    if (expDateEl && !String(expDateEl.value || "").trim()) expDateEl.value = isoTodayLocal();

    if (document.getElementById("accountSetupWizard")) {
      let target = 0;
      const ws = Number(o.wizardStep);
      if (Number.isFinite(ws) && ws >= 0 && ws <= 3) target = ws;
      else if (o.step === "transactions" || (Array.isArray(o.transactions) && o.transactions.length)) target = 2;
      else if (o.account && o.account.name) target = 1;
      setAccountSetupWizardStep(target, { skipPersist: true });
      if (target === 2 && document.getElementById("accountSetupWizardPanel2")) {
        const wantForm =
          String(o.step3Phase || "") === "form" ||
          (Array.isArray(o.transactions) && o.transactions.length > 0);
        if (wantForm) setAccountSetupStep3Phase("form");
        else syncAccountSetupWizardShellButtons();
      }
      if (target === 3 && document.getElementById("accountSetupWizardPanel3")) {
        if (String(o.expensePhase || "") === "form") setAccountSetupExpensePhase("form");
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
    "asTxAddMoreIncomeBtn",
    "asTxCancelIncomeBtn",
    "asExpSaveBtn",
    "asExpAddMoreBtn",
    "asExpCancelBtn",
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
    await request(`/api/families/${encodeURIComponent(String(familyId))}/accounts`, "POST", {
      name: a.name,
      type: a.type,
      starting_balance: a.starting_balance,
      starting_balance_date: a.starting_balance_date,
    });
  } catch (_) {}
}

async function maybeCreateFirstTransactionFromDraft(draft) {
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
  } catch (_) {}
}

async function doSignup() {
  if (!signupBtn) return;
  setBusy(true);
  setCallout(signupCalloutEl, "Creating your account...", "pending");
  try {
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

    const check = await verifySessionWithProgress(signupCalloutEl);
    if (!check.ok) {
      setCallout(signupCalloutEl, "Account created, but session cookie was not detected. Try logging in.", "error");
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
    await maybeCreateFirstAccountFromDraft(draft);
    await maybeCreateFirstTransactionFromDraft(draft);

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
  hydrateAccountSetupDraft();
  if (isAccountSetupPath()) {
    const dateEl = document.getElementById("asTxDate");
    if (dateEl && !String(dateEl.value || "").trim()) dateEl.value = isoTodayLocal();
    const expDateEl = document.getElementById("asExpTxDate");
    if (expDateEl && !String(expDateEl.value || "").trim()) expDateEl.value = isoTodayLocal();
  }
  try {
    initAccountSetupTransactionUi();
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
        void (async () => {
          if (signupBtn) signupBtn.disabled = true;
          const chk = await request("/api/auth/check-email", "POST", { email });
          if (signupBtn) signupBtn.disabled = false;
          if (!chk.ok) {
            setCallout(signupCalloutEl, messageFromFailure(chk, "Could not verify email. Try again."), "error");
            return;
          }
          if (chk.data && chk.data.exists === true) {
            openAccountSetupDuplicateEmailModal();
            return;
          }
          lockAccountSetupWizardStepTransition();
          setAccountSetupWizardStep(1);
          document.getElementById("accountName")?.focus();
        })();
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
        document.querySelector('input[name="asRecurringIncomePref"]')?.focus();
        return;
      }
      if (st === 2) {
        if (getAccountSetupStep3Phase() === "intro") {
          const pref = document.querySelector('input[name="asRecurringIncomePref"]:checked');
          const v = pref ? String(pref.value) : "";
          if (!v) {
            setCallout(signupCalloutEl, "Please choose Yes or Not Now.", "error");
            return;
          }
          if (v === "not_now") {
            setCallout(signupCalloutEl, "", "");
            try {
              const rawDraft = readAccountSetupDraftRaw() || {};
              const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
              const accountName = (document.getElementById("accountName")?.value || "").trim();
              const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
              const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
              const accountStartingBalanceDate = String(
                document.getElementById("accountStartingBalanceDate")?.value || ""
              ).trim();
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
              sessionStorage.setItem(
                BW_ACCOUNT_SETUP_DRAFT_KEY,
                JSON.stringify({
                  ...rawDraft,
                  wizardStep: 3,
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
                  transactions: existing,
                })
              );
            } catch (_) {}
            lockAccountSetupWizardStepTransition();
            setAccountSetupWizardStep(3, { skipPersist: true });
            setAccountSetupExpensePhase("intro");
            document.querySelector('input[name="asRecurringExpensePref"]')?.focus();
            return;
          }
          setAccountSetupStep3Phase("form");
          document.getElementById("asTxAmount")?.focus();
          return;
        }
        return;
      }
      if (st === 3) {
        if (getAccountSetupExpensePhase() === "intro") {
          const pref = document.querySelector('input[name="asRecurringExpensePref"]:checked');
          const v = pref ? String(pref.value) : "";
          if (!v) {
            setCallout(signupCalloutEl, "Please choose Yes or Not Now.", "error");
            return;
          }
          if (v === "not_now") {
            setCallout(signupCalloutEl, "", "");
            try {
              const rawDraft = readAccountSetupDraftRaw() || {};
              const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];
              const accountName = (document.getElementById("accountName")?.value || "").trim();
              const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
              const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
              const accountStartingBalanceDate = String(
                document.getElementById("accountStartingBalanceDate")?.value || ""
              ).trim();
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
              sessionStorage.setItem(
                BW_ACCOUNT_SETUP_DRAFT_KEY,
                JSON.stringify({
                  ...rawDraft,
                  wizardStep: 3,
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
                  transactions: existing,
                })
              );
            } catch (_) {}
            void doSignup();
            return;
          }
          setAccountSetupExpensePhase("form");
          document.getElementById("asExpTxAmount")?.focus();
          return;
        }
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
window.__bwSignup = onSignupPrimaryClick;
if (signupBtn) signupBtn.addEventListener("click", onSignupPrimaryClick);
if (addMoreTxBtn) addMoreTxBtn.addEventListener("click", addMoreTransactionsFromAccountSetup);
document.getElementById("asTxSaveIncomeBtn")?.addEventListener("click", () => void accountSetupSaveIncomeClick());
document.getElementById("asTxAddMoreIncomeBtn")?.addEventListener("click", () => addMoreTransactionsFromAccountSetup());
document.getElementById("asTxCancelIncomeBtn")?.addEventListener("click", () => accountSetupCancelIncomeClick());
document.getElementById("asExpSaveBtn")?.addEventListener("click", () => void accountSetupSaveExpenseClick());
document.getElementById("asExpAddMoreBtn")?.addEventListener("click", () => addMoreExpensesFromAccountSetup());
document.getElementById("asExpCancelBtn")?.addEventListener("click", () => accountSetupCancelExpenseClick());
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
    if (s === 3) {
      setAccountSetupWizardStep(2);
      const raw = readAccountSetupDraftRaw() || {};
      if (String(raw.step3Phase || "") === "form") setAccountSetupStep3Phase("form");
      else setAccountSetupStep3Phase("intro");
      if (getAccountSetupStep3Phase() === "intro") document.querySelector('input[name="asRecurringIncomePref"]')?.focus();
      else document.getElementById("asTxAmount")?.focus();
      return;
    }
    setAccountSetupWizardStep(s - 1);
    if (s - 1 === 0) document.getElementById("email")?.focus();
    else document.getElementById("accountName")?.focus();
  });
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

