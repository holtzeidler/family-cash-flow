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

function goApp() {
  window.location.href = "./";
}

const loginCalloutEl = document.getElementById("loginCallout");
const loginDiagCalloutEl = document.getElementById("loginDiagCallout");
const registerCalloutEl = document.getElementById("registerCallout");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");

function initContactUsLink() {
  const a = document.getElementById("contactUsLink");
  if (!a) return;
  const user = "tracyapro";
  const host = "hotmail.com";
  const email = `${user}@${host}`;
  const subject = "BalanceWhiz support";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}`;
  });
}

initContactUsLink();

function setSectionOpen(sectionEl, toggleBtnEl, bodyEl, isOpen) {
  if (!sectionEl || !toggleBtnEl || !bodyEl) return;
  sectionEl.classList.toggle("auth-section--open", !!isOpen);
  toggleBtnEl.setAttribute("aria-expanded", isOpen ? "true" : "false");
  bodyEl.hidden = !isOpen;
}

function initAccordion() {
  const loginSection = document.getElementById("loginSection");
  const loginToggle = document.getElementById("loginSectionToggle");
  const loginBody = document.getElementById("loginSectionBody");
  const registerSection = document.getElementById("registerSection");
  const registerToggle = document.getElementById("registerSectionToggle");
  const registerBody = document.getElementById("registerSectionBody");

  // Defaults: Login open, Create account closed.
  setSectionOpen(loginSection, loginToggle, loginBody, true);
  setSectionOpen(registerSection, registerToggle, registerBody, false);

  if (loginToggle) {
    loginToggle.addEventListener("click", () => {
      setSectionOpen(loginSection, loginToggle, loginBody, true);
      setSectionOpen(registerSection, registerToggle, registerBody, false);
    });
  }
  if (registerToggle) {
    registerToggle.addEventListener("click", () => {
      setSectionOpen(loginSection, loginToggle, loginBody, false);
      setSectionOpen(registerSection, registerToggle, registerBody, true);
    });
  }
}

initAccordion();

function getClientOrigin() {
  return window.location.origin;
}

async function fetchServerPublicConfig() {
  const r = await request("/api/debug/public-config", "GET");
  if (!r.ok || !r.data) return null;
  return r.data;
}

function formatServerDiag(srv) {
  if (!srv) return " (Could not load /api/debug/public-config from API.)";
  const origins = Array.isArray(srv.cors_allow_origins) ? srv.cors_allow_origins.join(", ") : String(srv.cors_allow_origins);
  return (
    ` | SERVER: env=${srv.env}, cookie SameSite=${srv.auth_cookie_samesite}, secure=${srv.auth_cookie_secure}, ` +
    `CORS middleware=${srv.cors_middleware_enabled}, allow_origins=[${origins}]`
  );
}

async function renderDiagnostics() {
  const apiBase = getApiBase() || "(empty)";
  const origin = getClientOrigin();
  let msg =
    `Client: API_BASE=${apiBase} | Origin=${origin} | CORS must allow ${origin}`;
  const srv = await fetchServerPublicConfig();
  msg += formatServerDiag(srv);
  setCallout(loginDiagCalloutEl, msg, srv ? "ok" : "pending");
}

function setBusy(isBusy) {
  loginBtn.disabled = isBusy;
  registerBtn.disabled = isBusy;
  loginBtn.textContent = isBusy ? "Logging in..." : "Login";
  registerBtn.textContent = isBusy ? "Working..." : "Register";
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

async function verifySessionWithProgress(targetInfoEl) {
  const attempts = [0, 800, 1800, 3200];
  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i] > 0) {
      await new Promise((resolve) => setTimeout(resolve, attempts[i]));
    }
    setCallout(targetInfoEl, `Login accepted. Verifying session cookie (${i + 1}/${attempts.length})...`, "pending");
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

if (location.hostname.endsWith("github.io") && !getApiBase()) {
  const msg =
    "This site was built without API_BASE. Repo > Settings > Secrets > Actions > set API_BASE to your Render API URL, then re-run Deploy frontend to GitHub Pages.";
  setCallout(loginCalloutEl, msg, "error");
  setCallout(registerCalloutEl, msg, "error");
} else {
  void renderDiagnostics();
}

loginBtn.addEventListener("click", async () => {
  setBusy(true);
  setCallout(loginCalloutEl, "Contacting API...", "pending");
  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const loginResp = await request("/api/auth/login", "POST", { email, password });
    if (!loginResp.ok) {
      setCallout(loginCalloutEl, messageFromFailure(loginResp, "Login failed"), "error");
      return;
    }

    const check = await verifySessionWithProgress(loginCalloutEl);
    if (!check.ok) {
      const srv = await fetchServerPublicConfig();
      const base =
        "Login succeeded, but /api/auth/me did not see your session cookie. For GitHub Pages + Render, ENV must be production (SameSite=None; Secure).";
      setCallout(loginCalloutEl, base + formatServerDiag(srv), "error");
      return;
    }
    setCallout(loginCalloutEl, "Session ready. Opening app...", "ok");
    goApp();
  } catch (e) {
    setCallout(loginCalloutEl, (e && e.message) || "Login failed", "error");
  } finally {
    setBusy(false);
  }
});

registerBtn.addEventListener("click", async () => {
  setBusy(true);
  setCallout(registerCalloutEl, "Creating account...", "pending");
  try {
    const name = document.getElementById("regName").value.trim() || null;
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const regResp = await request("/api/auth/register", "POST", { name, email, password });
    if (!regResp.ok) {
      setCallout(registerCalloutEl, messageFromFailure(regResp, "Registration failed"), "error");
      return;
    }
    const check = await verifySessionWithProgress(registerCalloutEl);
    if (!check.ok) {
      const srv = await fetchServerPublicConfig();
      const base =
        "Account created, but /api/auth/me did not see your session cookie. Set Render ENV=production for cross-site cookies.";
      setCallout(registerCalloutEl, base + formatServerDiag(srv), "error");
      return;
    }
    setCallout(registerCalloutEl, "Account created and session ready. Opening app...", "ok");
    goApp();
  } catch (e) {
    setCallout(registerCalloutEl, (e && e.message) || "Registration failed", "error");
  } finally {
    setBusy(false);
  }
});
