function getApiBase() {
  const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  return b.replace(/\/$/, "");
}

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

async function fetchServerPublicConfig() {
  return request("/api/debug/public-config", "GET");
}

function formatServerDiag(resp) {
  if (!resp || !resp.ok || !resp.data) return "";
  try {
    return ` ${JSON.stringify(resp.data).slice(0, 400)}`;
  } catch (_) {
    return "";
  }
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
      window.location.href = "./";
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
      window.location.href = "./invite/?token=" + enc;
      return;
    }
    window.location.href = "./invite/?token=" + enc;
  } catch (_) {
    window.location.href = "./";
  }
}

const loginCalloutEl = document.getElementById("loginCallout");
const loginBtn = document.getElementById("loginBtn");
const authFlowTitle = document.getElementById("authFlowTitle");
const flows = {
  login: document.getElementById("loginFlowLogin"),
  forgotRequest: document.getElementById("forgot"),
  forgotSent: document.getElementById("loginFlowForgotSent"),
  reset: document.getElementById("loginFlowReset"),
  resetSuccess: document.getElementById("loginFlowResetSuccess"),
};

let activeResetToken = "";

function showPwFlowErr(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function showFlow(name) {
  const titles = {
    login: "Welcome back",
    forgotRequest: "Reset your password",
    forgotSent: "Check your email",
    reset: "Create a new password",
    resetSuccess: "Password updated",
  };
  if (authFlowTitle) authFlowTitle.textContent = titles[name] || titles.login;
  for (const k of Object.keys(flows)) {
    const el = flows[k];
    if (!el) continue;
    el.hidden = k !== name;
  }
  setCallout(loginCalloutEl, "", "");
}

function clearResetQuery() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("reset");
    const qs = u.searchParams.toString();
    window.history.replaceState({}, "", u.pathname + (qs ? `?${qs}` : "") + u.hash);
  } catch (_) {}
}

function backToLogin() {
  activeResetToken = "";
  clearResetQuery();
  showFlow("login");
}

async function doLogin() {
  if (!loginBtn) return;
  setBusy(true);
  setCallout(loginCalloutEl, "", "");
  try {
    try {
      sessionStorage.removeItem(BW_API_ACCESS_TOKEN_KEY);
    } catch (_) {}
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const loginResp = await request("/api/auth/login", "POST", { email, password });
    if (!loginResp.ok) {
      setCallout(loginCalloutEl, messageFromFailure(loginResp, "Login failed"), "error");
      return;
    }
    try {
      const tok =
        loginResp.data && loginResp.data.access_token != null ? String(loginResp.data.access_token).trim() : "";
      if (tok) sessionStorage.setItem(BW_API_ACCESS_TOKEN_KEY, tok);
    } catch (_) {}

    const check = await verifySessionWithProgress(loginCalloutEl);
    if (!check.ok) {
      const srv = await fetchServerPublicConfig();
      const base =
        "Login succeeded, but /api/auth/me did not see your session cookie. For GitHub Pages + Render, ENV must be production (SameSite=None; Secure).";
      setCallout(loginCalloutEl, base + formatServerDiag(srv), "error");
      return;
    }
    setCallout(loginCalloutEl, "Session ready. Opening app...", "ok");
    await goApp();
  } catch (e) {
    setCallout(loginCalloutEl, (e && e.message) || "Login failed", "error");
  } finally {
    setBusy(false);
  }
}

function setSectionOpen(sectionEl, toggleBtnEl, bodyEl, isOpen) {
  if (!sectionEl || !bodyEl) return;
  sectionEl.classList.toggle("auth-section--open", !!isOpen);
  if (toggleBtnEl) toggleBtnEl.setAttribute("aria-expanded", isOpen ? "true" : "false");
  bodyEl.hidden = !isOpen;
}

function initAccordion() {
  const loginSection = document.getElementById("loginSection");
  const loginBody = document.getElementById("loginSectionBody");
  setSectionOpen(loginSection, null, loginBody, true);
}

initAccordion();

function getClientOrigin() {
  return window.location.origin;
}

function setBusy(isBusy) {
  if (!loginBtn) return;
  loginBtn.disabled = isBusy;
  loginBtn.textContent = isBusy ? "Logging in..." : "Login";
}

function networkHint() {
  const apiBase = getApiBase() || "(empty)";
  const origin = getClientOrigin();
  if (!location.hostname.endsWith("github.io")) return "";
  return (
    ` Could not reach API. Current API_BASE=${apiBase}. Browser Origin=${origin}. ` +
    `Check API_BASE secret points to your Render URL (https://...onrender.com, no trailing slash), ` +
    `and Render CORS_ORIGINS includes ${origin}`
  );
}

async function verifySessionWithProgress() {
  const attempts = [0, 800, 1800, 3200];
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) {
      await new Promise((resolve) => setTimeout(resolve, attempts[i]));
    }
    const me = await request("/api/auth/me", "GET");
    if (me.ok && me.data && me.data.user) {
      return { ok: true, elapsedMs: me.elapsedMs };
    }
  }
  return { ok: false };
}

function messageFromFailure(resp, fallback) {
  if (resp.networkError) {
    return `${resp.networkError}.${networkHint()}`;
  }
  if (resp.status === 401) return "Invalid email or password.";
  if (resp.status === 409 && resp.data && resp.data.detail) return resp.data.detail;
  if (resp.status >= 500) {
    return (
      `Server error (${resp.status}). This may happen while Render/Neon are waking up. ` +
      "Try again in 30-60s. If it persists, check Render logs."
    );
  }
  if (resp.data && resp.data.detail) return resp.data.detail;
  return fallback;
}

async function sendPasswordResetRequest() {
  const btn = document.getElementById("pwForgotSendBtn");
  const emailEl = document.getElementById("pwForgotEmail");
  const errEl = document.getElementById("pwForgotRequestErr");
  const email = emailEl && emailEl.value ? String(emailEl.value).trim() : "";
  showPwFlowErr(errEl, "");
  if (!email) {
    showPwFlowErr(errEl, "Please enter your email.");
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Sending…";
  }
  try {
    const r = await request("/api/public/password-reset/request", "POST", { email });
    if (!r.ok) {
      if (r.status === 429) {
        showPwFlowErr(errEl, "Too many requests. Please try again later.");
        return;
      }
      showPwFlowErr(errEl, messageFromFailure(r, "Could not send reset link."));
      return;
    }
    showFlow("forgotSent");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Send reset link";
    }
  }
}

async function runResetTokenValidate() {
  const busy = document.getElementById("pwResetBusy");
  const formWrap = document.getElementById("pwResetFormWrap");
  const invalidWrap = document.getElementById("pwResetInvalidWrap");
  if (busy) busy.hidden = false;
  if (formWrap) formWrap.hidden = true;
  if (invalidWrap) invalidWrap.hidden = true;
  const enc = encodeURIComponent(activeResetToken);
  const r = await request(`/api/public/password-reset/validate?token=${enc}`, "GET");
  if (busy) busy.hidden = true;
  if (r.ok) {
    if (formWrap) formWrap.hidden = false;
    const p1 = document.getElementById("pwResetNew");
    const p2 = document.getElementById("pwResetConfirm");
    if (p1) p1.value = "";
    if (p2) p2.value = "";
    showPwFlowErr(document.getElementById("pwResetFormErr"), "");
  } else {
    if (invalidWrap) invalidWrap.hidden = false;
  }
}

async function submitNewPassword() {
  const errEl = document.getElementById("pwResetFormErr");
  const btn = document.getElementById("pwResetSaveBtn");
  const p1 = document.getElementById("pwResetNew");
  const p2 = document.getElementById("pwResetConfirm");
  const a = p1 && p1.value ? String(p1.value) : "";
  const b = p2 && p2.value ? String(p2.value) : "";
  showPwFlowErr(errEl, "");
  if (a.length < 8) {
    showPwFlowErr(errEl, "Password must be at least 8 characters.");
    return;
  }
  if (a !== b) {
    showPwFlowErr(errEl, "Passwords do not match.");
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  try {
    const r = await request("/api/public/password-reset/complete", "POST", {
      token: activeResetToken,
      new_password: a,
    });
    if (!r.ok) {
      const msg =
        r.data && r.data.detail
          ? String(r.data.detail)
          : "This reset link has expired or has already been used.";
      showPwFlowErr(errEl, msg);
      return;
    }
    activeResetToken = "";
    clearResetQuery();
    showFlow("resetSuccess");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save new password";
    }
  }
}

function wirePasswordResetUi() {
  const forgotBtn = document.getElementById("loginForgotBtn");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", () => {
      const mainEmail = document.getElementById("email");
      const fe = document.getElementById("pwForgotEmail");
      if (fe && mainEmail) fe.value = String(mainEmail.value || "").trim();
      showPwFlowErr(document.getElementById("pwForgotRequestErr"), "");
      showFlow("forgotRequest");
    });
  }
  const backSelectors = ["pwForgotBackLogin1", "pwForgotSentBackBtn", "pwResetFormBackBtn", "pwResetInvalidBackBtn", "pwResetSuccessBtn"];
  for (const id of backSelectors) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => backToLogin());
  }
  const sendBtn = document.getElementById("pwForgotSendBtn");
  if (sendBtn) sendBtn.addEventListener("click", () => void sendPasswordResetRequest());
  const saveBtn = document.getElementById("pwResetSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", () => void submitNewPassword());
  const reqNew = document.getElementById("pwResetInvalidRequestBtn");
  if (reqNew) {
    reqNew.addEventListener("click", () => {
      clearResetQuery();
      activeResetToken = "";
      showFlow("forgotRequest");
    });
  }
}

if (location.hostname.endsWith("github.io") && !getApiBase()) {
  const msg =
    "This site was built without API_BASE. Repo > Settings > Secrets > Actions > set API_BASE to your Render API URL, then re-run Deploy frontend to GitHub Pages.";
  setCallout(loginCalloutEl, msg, "error");
}

window.__bwLogin = () => void doLogin();
if (loginBtn) loginBtn.addEventListener("click", () => void doLogin());

wirePasswordResetUi();

try {
  const t = new URLSearchParams(location.search).get("invite");
  if (t && String(t).trim()) sessionStorage.setItem("bw_invite_token", String(t).trim());
  else sessionStorage.removeItem("bw_invite_token");
} catch (_) {}

try {
  const tok = new URLSearchParams(location.search).get("reset");
  if (tok && String(tok).trim().length >= 24) {
    activeResetToken = String(tok).trim();
    showFlow("reset");
    void runResetTokenValidate();
  }
} catch (_) {}

try {
  const resetTok = new URLSearchParams(location.search).get("reset");
  if (!resetTok && location.hash === "#forgot" && flows.forgotRequest) {
    const fe = document.getElementById("pwForgotEmail");
    const mainEmail = document.getElementById("email");
    if (fe && mainEmail) fe.value = String(mainEmail.value || "").trim();
    showPwFlowErr(document.getElementById("pwForgotRequestErr"), "");
    showFlow("forgotRequest");
  }
} catch (_) {}
