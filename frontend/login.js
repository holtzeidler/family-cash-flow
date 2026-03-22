function getApiBase() {
  const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  return b.replace(/\/$/, "");
}

async function api(path, method, body) {
  const apiBase = getApiBase();
  const fullPath = `${apiBase}${path}`;
  let res;
  try {
    res = await fetch(fullPath, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const hint =
      location.hostname.endsWith("github.io")
        ? " Cannot reach API. Set GitHub Actions secret API_BASE to your Render URL (https://….onrender.com, no trailing slash), re-run “Deploy frontend to GitHub Pages”, and set Render env CORS_ORIGINS=https://holtzeidler.github.io"
        : "";
    throw new Error(((e && e.message) || "Network error") + hint);
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.detail) msg = data.detail;
    } catch (_) {}
    throw new Error(msg);
  }
  // Some endpoints intentionally return empty bodies.
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

function setErr(el, msg) {
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function goApp() {
  window.location.href = "./";
}

const errEl = document.getElementById("err");
const errEl2 = document.getElementById("err2");

if (location.hostname.endsWith("github.io") && !getApiBase()) {
  const msg =
    "This site was built without API_BASE. Repo → Settings → Secrets → Actions → set API_BASE to your Render API URL, then re-run “Deploy frontend to GitHub Pages”.";
  setErr(errEl, msg);
  setErr(errEl2, msg);
}

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    setErr(errEl, "");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    await api("/api/auth/login", "POST", { email, password });
    goApp();
  } catch (e) {
    setErr(errEl, e.message || "Login failed");
  }
});

document.getElementById("registerBtn").addEventListener("click", async () => {
  try {
    setErr(errEl2, "");
    const name = document.getElementById("regName").value.trim() || null;
    const email = document.getElementById("regEmail").value.trim();
    const password = document.getElementById("regPassword").value;
    await api("/api/auth/register", "POST", { name, email, password });
    goApp();
  } catch (e) {
    setErr(errEl2, e.message || "Registration failed");
  }
});

