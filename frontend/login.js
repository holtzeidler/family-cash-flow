function getApiBase() {
  const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  return b.replace(/\/$/, "");
}

async function request(path, method, body) {
  const apiBase = getApiBase();
  const fullPath = `${apiBase}${path}`;
  const startedAt = Date.now();
  const init = {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  };
  const allowRetry = method === "GET" && !body;
  const maxAttempts = allowRetry ? 3 : 1;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 750 * attempt));
      }
      const res = await fetch(fullPath, init);
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
      lastErr = e;
    }
  }
  return {
    ok: false,
    status: null,
    data: null,
    elapsedMs: Date.now() - startedAt,
    networkError: (lastErr && lastErr.message) || "Network error",
  };
}

function setErr(el, msg) {
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function setInfo(el, msg, mode = "pending") {
  el.textContent = msg || "";
  el.className = mode ? `info ${mode}` : "info";
  el.style.display = msg ? "block" : "none";
}

function goApp() {
  window.location.href = "./";
}

const errEl = document.getElementById("err");
const errEl2 = document.getElementById("err2");
const loginStatusEl = document.getElementById("loginStatus");
const registerStatusEl = document.getElementById("registerStatus");
const diagEl = document.getElementById("diag");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");

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
  setInfo(diagEl, msg, srv ? "ok" : "pending");
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
    setInfo(targetInfoEl, `Login accepted. Verifying session cookie (${i + 1}/${attempts.length})...`, "pending");
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
  setErr(errEl, msg);
  setErr(errEl2, msg);
} else {
  void renderDiagnostics();
}

loginBtn.addEventListener("click", async () => {
  setBusy(true);
  setInfo(loginStatusEl, "Contacting API...", "pending");
  setErr(errEl, "");
  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const loginResp = await request("/api/auth/login", "POST", { email, password });
    if (!loginResp.ok) {
      setInfo(loginStatusEl, "");
      setErr(errEl, messageFromFailure(loginResp, "Login failed"));
      return;
    }

    const check = await verifySessionWithProgress(loginStatusEl);
    if (!check.ok) {
      setInfo(loginStatusEl, "");
      const srv = await fetchServerPublicConfig();
      const base =
        "Login succeeded, but /api/auth/me did not see your session cookie. For GitHub Pages + Render, ENV must be production (SameSite=None; Secure).";
      setErr(errEl, base + formatServerDiag(srv));
      return;
    }
    setInfo(loginStatusEl, "Session ready. Opening app...", "ok");
    goApp();
  } catch (e) {
    setInfo(loginStatusEl, "");
    setErr(errEl, (e && e.message) || "Login failed");
  } finally {
    setBusy(false);
  }
});

registerBtn.addEventListener("click", async () => {
  setBusy(true);
  setInfo(registerStatusEl, "Creating account...", "pending");
  setErr(errEl2, "");
  try {
    const name = document.getElementById("regName").value.trim() || null;
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    const regResp = await request("/api/auth/register", "POST", { name, email, password });
    if (!regResp.ok) {
      setInfo(registerStatusEl, "");
      setErr(errEl2, messageFromFailure(regResp, "Registration failed"));
      return;
    }
    const check = await verifySessionWithProgress(registerStatusEl);
    if (!check.ok) {
      setInfo(registerStatusEl, "");
      const srv = await fetchServerPublicConfig();
      const base =
        "Account created, but /api/auth/me did not see your session cookie. Set Render ENV=production for cross-site cookies.";
      setErr(errEl2, base + formatServerDiag(srv));
      return;
    }
    setInfo(registerStatusEl, "Account created and session ready. Opening app...", "ok");
    goApp();
  } catch (e) {
    setInfo(registerStatusEl, "");
    setErr(errEl2, (e && e.message) || "Registration failed");
  } finally {
    setBusy(false);
  }
});
