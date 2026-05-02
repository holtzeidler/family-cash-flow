function setErr(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function setOk(el, show) {
  if (!el) return;
  el.style.display = show ? "block" : "none";
}

function buildMailtoUrl({ to, subject, body }) {
  const parts = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return `mailto:${to}${qs}`;
}

function getSupportEmail() {
  return "support@balancewhiz.com";
}

function getApiBase() {
  const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
  return String(b || "").replace(/\/$/, "");
}

async function api(path, method = "GET") {
  const apiBase = getApiBase();
  const fullPath = `${apiBase}${path}`;
  await fetch(fullPath, { method, credentials: "include" });
}

function initLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch (_) {}
    window.location.href = "../login.html";
  });
}

initLogout();

const form = document.getElementById("contactForm");
const errEl = document.getElementById("contactErr");
const okEl = document.getElementById("contactOk");
const nameEl = document.getElementById("contactName");
const emailEl = document.getElementById("contactEmail");
const subjectEl = document.getElementById("contactSubject");
const messageEl = document.getElementById("contactMessage");
const sendBtn = document.getElementById("contactSendBtn");

async function readErrorDetail(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (j && typeof j.detail === "string") return j.detail;
    if (j && j.detail != null) return JSON.stringify(j.detail);
  } catch (_) {
    /* ignore */
  }
  return text.slice(0, 400) || "Request failed.";
}

function openMailtoFallback(name, email, subject, msg) {
  const to = getSupportEmail();
  const fullSubject = subject ? `BalanceWhiz: ${subject}` : "BalanceWhiz: Contact Us";
  const body = `Name: ${name}\n` + `Email: ${email}\n\n` + `${msg}\n`;
  window.location.href = buildMailtoUrl({ to, subject: fullSubject, body });
}

if (form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    setErr(errEl, "");
    setOk(okEl, false);

    const name = String((nameEl && nameEl.value) || "").trim();
    const email = String((emailEl && emailEl.value) || "").trim();
    const subject = String((subjectEl && subjectEl.value) || "").trim() || "General question";
    const msg = String((messageEl && messageEl.value) || "").trim();

    if (!name) {
      setErr(errEl, "Name is required.");
      return;
    }
    if (!email) {
      setErr(errEl, "Email is required.");
      return;
    }
    if (!msg) {
      setErr(errEl, "Message is required.");
      return;
    }

    const apiBase = getApiBase();
    const sendLabel = (sendBtn && sendBtn.textContent) || "Send";
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
    }

    try {
      if (apiBase) {
        var ctrl = new AbortController();
        var tid = setTimeout(function () {
          ctrl.abort();
        }, 28000);
        var res;
        try {
          res = await fetch(apiBase + "/api/public/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, email: email, subject: subject, message: msg }),
            credentials: "omit",
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(tid);
        }
        if (res.ok) {
          form.reset();
          setOk(okEl, true);
          return;
        }
        if (res.status === 503) {
          openMailtoFallback(name, email, subject, msg);
          return;
        }
        setErr(errEl, await readErrorDetail(res));
        return;
      }

      openMailtoFallback(name, email, subject, msg);
    } catch (err) {
      if (err && err.name === "AbortError") {
        setErr(
          errEl,
          "The server did not answer in time. Opening your email app instead — you can send the same message from there."
        );
      }
      openMailtoFallback(name, email, subject, msg);
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = sendLabel;
      }
    }
  });
}
