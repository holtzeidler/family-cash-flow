async function api(path, method, body) {
  const apiBase = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  const fullPath = `${apiBase}${path}`;
  const res = await fetch(fullPath, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
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

