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

async function doLogin() {
  if (!loginBtn) return;
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
    await goApp();
  } catch (e) {
    setCallout(loginCalloutEl, (e && e.message) || "Login failed", "error");
  } finally {
    setBusy(false);
  }
}

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

  // Defaults: Login open.
  setSectionOpen(loginSection, loginToggle, loginBody, true);

  if (loginToggle) {
    loginToggle.addEventListener("click", () => {
      setSectionOpen(loginSection, loginToggle, loginBody, true);
    });
  }
}

initAccordion();

function getClientOrigin() {
  return window.location.origin;
}

function setBusy(isBusy) {
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
}

// Expose a global handler so the inline onclick works even if the event binding fails.
window.__bwLogin = () => void doLogin();
if (loginBtn) loginBtn.addEventListener("click", () => void doLogin());

try {
  const t = new URLSearchParams(location.search).get("invite");
  if (t && String(t).trim()) sessionStorage.setItem("bw_invite_token", String(t).trim());
  else sessionStorage.removeItem("bw_invite_token");
} catch (_) {}
