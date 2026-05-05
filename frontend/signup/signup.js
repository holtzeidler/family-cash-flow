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

const BW_ACCOUNT_SETUP_DRAFT_KEY = "bw_account_setup_draft";

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
    const firstName = (document.getElementById("firstName")?.value || "").trim();
    const lastName = (document.getElementById("lastName")?.value || "").trim();
    const timeZone = String(document.getElementById("timeZone")?.value || "").trim();
    if (!firstName) {
      setCallout(signupCalloutEl, "First name is required.", "error");
      return;
    }
    if (!lastName) {
      setCallout(signupCalloutEl, "Last name is required.", "error");
      return;
    }
    if (!timeZone) {
      setCallout(signupCalloutEl, "Time zone is required.", "error");
      return;
    }
    sessionStorage.setItem(BW_ACCOUNT_SETUP_DRAFT_KEY, JSON.stringify({ firstName, lastName, timeZone }));
  } catch (e) {
    setCallout(signupCalloutEl, (e && e.message) || "Could not continue.", "error");
    return;
  }
  const q = window.location.search || "";
  window.location.assign("/signup/" + q);
}

function listUsTimeZones() {
  return new Set([
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ]);
}

function hydrateDefaultTimeZone() {
  if (!isAccountSetupPath()) return;
  const tzEl = document.getElementById("timeZone");
  if (!tzEl) return;
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const tz = String(raw).trim();
    if (tz && listUsTimeZones().has(tz)) tzEl.value = tz;
  } catch (_) {}
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
    const nameEl = document.getElementById("name");
    const firstNameEl = document.getElementById("firstName");
    const lastNameEl = document.getElementById("lastName");
    const tzEl = document.getElementById("timeZone");
    if (nameEl && o.name) nameEl.value = String(o.name);
    if (firstNameEl && o.firstName) firstNameEl.value = String(o.firstName);
    if (lastNameEl && o.lastName) lastNameEl.value = String(o.lastName);
    if (tzEl && o.timeZone) tzEl.value = String(o.timeZone);
  } catch (_) {}
}

function showSignupPlanBanner() {
  if (signupBannerHead) signupBannerHead.hidden = false;
}

function setBusy(isBusy) {
  if (!signupBtn) return;
  signupBtn.disabled = isBusy;
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
    const timeZone = (o && o.timeZone != null ? String(o.timeZone) : "").trim();
    if (!firstName || !lastName || !timeZone) return null;
    return { firstName, lastName, timeZone };
  } catch (_) {
    return null;
  }
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
    const { firstName, lastName, timeZone } = draft;
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

    // Cache user-selected timezone for frontend display (until stored server-side).
    try {
      if (timeZone) localStorage.setItem("bw_time_zone", timeZone);
    } catch (_) {}

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
    signupPlanNoteEl.textContent = plan === "pro" ? "Selected Plan: Add Budgeting" : "Selected Plan: Cash Forecast Only";
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
  hydrateDefaultTimeZone();
})();

// Expose a global handler so the inline onclick works even if the event binding fails.
function onSignupPrimaryClick() {
  if (isAccountSetupPath()) void goToSignupFromAccountSetup();
  else if (isSignupPath()) void doSignup();
  else void goToAccountSetup();
}
window.__bwSignup = onSignupPrimaryClick;
if (signupBtn) signupBtn.addEventListener("click", onSignupPrimaryClick);

