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
    setCallout(targetInfoEl, `Account created. Verifying session cookie (${i + 1}/${attempts.length})...`, "pending");
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

const BW_ACCOUNT_SETUP_DRAFT_KEY = "bw_account_setup_draft";

function initAccountSetupCardAccordion() {
  if (!isAccountSetupPath()) return;
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
      const nowCollapsed = !card.classList.contains("is-collapsed");
      setCollapsed(card, nowCollapsed);
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

function toMoneyNumber(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function getAccountSetupStep() {
  if (!isAccountSetupPath()) return "account";
  if (!accountSetupTransactionsSectionEl) return "account";
  return accountSetupTransactionsSectionEl.hidden ? "account" : "transactions";
}

function setAccountSetupStep(step) {
  if (!isAccountSetupPath()) return;
  // New account-setup layout shows all cards at once.
  if (document.getElementById("accountSetupCards")) {
    if (signupBtn) signupBtn.textContent = "Create Account";
    if (addMoreTxBtn) addMoreTxBtn.style.display = "inline-flex";
    if (accountSetupAccountSectionEl) accountSetupAccountSectionEl.hidden = false;
    if (accountSetupTransactionsSectionEl) accountSetupTransactionsSectionEl.hidden = false;
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

function canAdvanceAccountSetupAccountStep({ firstName, lastName, accountName, accountStartingBalanceRaw, accountStartingBalance, accountStartingBalanceDate }) {
  if (!firstName) return { ok: false, message: "First name is required." };
  if (!lastName) return { ok: false, message: "Last name is required." };
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

    const firstName = (document.getElementById("firstName")?.value || "").trim();
    const lastName = (document.getElementById("lastName")?.value || "").trim();
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
    if (!firstName) {
      setCallout(signupCalloutEl, "First name is required.", "error");
      return;
    }
    if (!lastName) {
      setCallout(signupCalloutEl, "Last name is required.", "error");
      return;
    }
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
        firstName,
        lastName,
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
  const exp = document.querySelector('input[name="asTxKind"][value="expense"]');
  if (exp) exp.checked = true;
}

function addMoreTransactionsFromAccountSetup() {
  if (!isAccountSetupPath()) return;
  setCallout(signupCalloutEl, "", "");
  const rawDraft = readAccountSetupDraftRaw() || {};
  const firstName = (document.getElementById("firstName")?.value || "").trim();
  const lastName = (document.getElementById("lastName")?.value || "").trim();
  const accountName = (document.getElementById("accountName")?.value || "").trim();
  const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
  const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
  const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();

  const gate = canAdvanceAccountSetupAccountStep({
    firstName,
    lastName,
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
      firstName,
      lastName,
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

function hydrateAccountSetupDraft() {
  if (!isAccountSetupPath()) return;
  let raw = "";
  try {
    raw = sessionStorage.getItem(BW_ACCOUNT_SETUP_DRAFT_KEY) || "";
  } catch (_) {}
  if (!raw) return;
  try {
    const o = JSON.parse(raw);
    const firstNameEl = document.getElementById("firstName");
    const lastNameEl = document.getElementById("lastName");
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
    if (firstNameEl && o.firstName) firstNameEl.value = String(o.firstName);
    if (lastNameEl && o.lastName) lastNameEl.value = String(o.lastName);
    if (tzEl && o.timeZone) tzEl.value = String(o.timeZone);
    if (o.account) {
      if (accNameEl && o.account.name) accNameEl.value = String(o.account.name);
      if (accBalEl && o.account.starting_balance != null) accBalEl.value = String(o.account.starting_balance);
      if (accDateEl && o.account.starting_balance_date) accDateEl.value = String(o.account.starting_balance_date);
    }
    const lastTx = Array.isArray(o.transactions) && o.transactions.length ? o.transactions[o.transactions.length - 1] : o.transaction;
    if (lastTx) {
      const k = String(lastTx.kind || "").trim().toLowerCase();
      const kindEl = k ? document.querySelector(`input[name="asTxKind"][value="${k}"]`) : null;
      if (kindEl) kindEl.checked = true;
      if (txAmountEl && lastTx.amount != null) txAmountEl.value = String(lastTx.amount);
      if (txCategoryEl && lastTx.category) txCategoryEl.value = String(lastTx.category);
      if (txDateEl && lastTx.date) txDateEl.value = String(lastTx.date);
      if (txNotesEl && lastTx.notes) txNotesEl.value = String(lastTx.notes);
      if (txRecurringEl) txRecurringEl.checked = !!lastTx.recurring;
      if (txBgColorEl && lastTx.bg_color) txBgColorEl.value = String(lastTx.bg_color);
    }
    if (txDateEl && !txDateEl.value) txDateEl.value = isoTodayLocal();
    const step = String(o.step || "").trim().toLowerCase();
    if (step === "transactions" && o.firstName && o.lastName) setAccountSetupStep("transactions");
  } catch (_) {}
}

function showSignupPlanBanner() {
  if (signupBannerHead) signupBannerHead.hidden = false;
}

function setBusy(isBusy) {
  if (!signupBtn) return;
  signupBtn.disabled = isBusy;
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
    const firstName = (o && o.firstName != null ? String(o.firstName) : "").trim();
    const lastName = (o && o.lastName != null ? String(o.lastName) : "").trim();
    if (!firstName || !lastName) return null;
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
    return { firstName, lastName, timeZone: "", account, transactions };
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
    const { firstName, lastName } = draft;
    const name = `${firstName} ${lastName}`.trim();
    const email = (document.getElementById("email")?.value || "").trim();
    const password = document.getElementById("password")?.value || "";
    const password2 = document.getElementById("password2")?.value || "";

    if (!email) throw new Error("Email is required.");
    if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (password !== password2) throw new Error("Passwords do not match.");

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
  }
})();

// Expose a global handler so the inline onclick works even if the event binding fails.
function onSignupPrimaryClick() {
  if (isAccountSetupPath()) {
    // With the 3-card layout we create the account directly from this page.
    if (document.getElementById("accountSetupCards")) {
      setCallout(signupCalloutEl, "", "");
      try {
        const rawDraft = readAccountSetupDraftRaw() || {};
        const existing = Array.isArray(rawDraft.transactions) ? rawDraft.transactions : [];

        const firstName = (document.getElementById("firstName")?.value || "").trim();
        const lastName = (document.getElementById("lastName")?.value || "").trim();
        const accountName = (document.getElementById("accountName")?.value || "").trim();
        const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
        const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
        const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();

        const gate = canAdvanceAccountSetupAccountStep({
          firstName,
          lastName,
          accountName,
          accountStartingBalanceRaw,
          accountStartingBalance,
          accountStartingBalanceDate,
        });
        if (!gate.ok) {
          setCallout(signupCalloutEl, gate.message, "error");
          return;
        }

        const parsed = readAccountSetupTransactionFromInputs();
        const txs = parsed.ok ? [...existing, parsed.tx] : existing;

        sessionStorage.setItem(
          BW_ACCOUNT_SETUP_DRAFT_KEY,
          JSON.stringify({
            ...rawDraft,
            firstName,
            lastName,
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
      return;
    }

    if (getAccountSetupStep() === "account") {
      setCallout(signupCalloutEl, "", "");
      try {
        const firstName = (document.getElementById("firstName")?.value || "").trim();
        const lastName = (document.getElementById("lastName")?.value || "").trim();
        const accountName = (document.getElementById("accountName")?.value || "").trim();
        const accountStartingBalanceRaw = document.getElementById("accountStartingBalance")?.value || "";
        const accountStartingBalance = toMoneyNumber(accountStartingBalanceRaw);
        const accountStartingBalanceDate = String(document.getElementById("accountStartingBalanceDate")?.value || "").trim();
        const gate = canAdvanceAccountSetupAccountStep({
          firstName,
          lastName,
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
            firstName,
            lastName,
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

function initAccountSetupTransactionUi() {
  if (!isAccountSetupPath()) return;
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
  initAccountSetupTransactionUi();
} catch (_) {}
try {
  initAccountSetupCardAccordion();
} catch (_) {}

