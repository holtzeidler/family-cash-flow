function setErr(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function setOk(el, show) {
  if (!el) return;
  el.style.display = show ? "block" : "none";
}

function hideContactTroubleshoot() {
  var box = document.getElementById("contactTroubleshoot");
  var list = document.getElementById("contactTroubleshootList");
  if (box) box.hidden = true;
  if (list) list.innerHTML = "";
}

function addTroubleshootLi(list, text) {
  var li = document.createElement("li");
  li.textContent = text;
  list.appendChild(li);
}

function addTroubleshootAdminLinkLi(list) {
  var li = document.createElement("li");
  li.appendChild(document.createTextNode("Open "));
  var a = document.createElement("a");
  a.href = "../admin/";
  a.textContent = "Admin diagnostics";
  li.appendChild(a);
  li.appendChild(
    document.createTextNode(
      " (Run API check) to see whether the server uses Resend or SMTP, CORS, and hints. On production: https://balancewhiz.com/admin/"
    )
  );
  list.appendChild(li);
}

function showContactTroubleshootFromApi(status, detail) {
  var list = document.getElementById("contactTroubleshootList");
  var box = document.getElementById("contactTroubleshoot");
  if (!list || !box) return;
  list.innerHTML = "";
  var d = String(detail || "").toLowerCase();

  if (status === 429) {
    addTroubleshootLi(
      list,
      "Too many contact attempts from this network (rate limit). Wait about 15 minutes, then try again."
    );
    addTroubleshootAdminLinkLi(list);
    box.hidden = false;
    return;
  }

  if (status === 502) {
    if (d.indexOf("1010") !== -1) {
      addTroubleshootLi(
        list,
        "Resend error 1010 means their edge blocked the request — usually because the HTTP client did not send a User-Agent header (Python’s urllib did not send one by default)."
      );
      addTroubleshootLi(
        list,
        "Deploy the latest BalanceWhiz API from GitHub (includes a fix). Then redeploy on Render and try Send again. Doc: https://resend.com/docs/knowledge-base/403-error-1010"
      );
    } else if (d.indexOf("could not send via resend") !== -1) {
      addTroubleshootLi(
        list,
        "Resend accepted the request from the API but returned an error (check the red line above for Resend’s message)."
      );
      addTroubleshootLi(
        list,
        "In the Resend dashboard: verify the sending domain, API key, and that RESEND_FROM matches an allowed sender."
      );
      addTroubleshootLi(list, "On Render: Environment → confirm RESEND_API_KEY, RESEND_FROM, CONTACT_EMAIL_TO; then Logs → search for \"Resend\".");
    } else if (d.indexOf("mail provider did not answer") !== -1) {
      addTroubleshootLi(list, "Resend’s HTTPS API did not answer in time. Try again; if it repeats, check Render outbound HTTPS and Resend status.");
      addTroubleshootLi(list, "Confirm RESEND_API_KEY is correct and the Render service was redeployed after you set env vars.");
    } else if (
      d.indexOf("email server did not finish") !== -1 ||
      d.indexOf("outbound smtp") !== -1 ||
      d.indexOf("microsoft 365 is slow") !== -1
    ) {
      addTroubleshootLi(
        list,
        "The API is using SMTP to Microsoft 365 from Render and that path did not finish in time (very common)."
      );
      addTroubleshootLi(
        list,
        "Best fix: in Render add RESEND_API_KEY + RESEND_FROM (see backend/.env.example), keep CONTACT_EMAIL_TO=support@balancewhiz.com, redeploy. The app sends via Resend first when those are set, which avoids SMTP from the datacenter."
      );
      addTroubleshootLi(
        list,
        "Optional: remove or ignore CONTACT_SMTP_* once Resend works so you are not tempted to debug Microsoft SMTP from GoDaddy/Render."
      );
    } else {
      addTroubleshootLi(list, "The API returned HTTP 502 (bad gateway) while sending mail. Open Render → this web service → Logs and look for SMTP or Resend lines.");
      addTroubleshootLi(
        list,
        "If you have not configured Resend yet, do that on Render first — it is the supported path when Microsoft SMTP times out."
      );
    }
    addTroubleshootAdminLinkLi(list);
    box.hidden = false;
    return;
  }

  if (status === 503) {
    addTroubleshootLi(
      list,
      "The API is not configured to send mail from the server (missing or empty env vars), so your browser will open your email app as a backup."
    );
    addTroubleshootLi(
      list,
      "To fix server send: on Render set CONTACT_EMAIL_TO and either RESEND_API_KEY + RESEND_FROM, or all CONTACT_SMTP_* fields; redeploy; then use Admin → Run API check — “Contact form” should show Ready."
    );
    addTroubleshootAdminLinkLi(list);
    box.hidden = false;
    return;
  }

  if (status === 400 || status === 422) {
    addTroubleshootLi(
      list,
      "The server rejected the form (validation). Check name, a valid email address, and a non-empty message."
    );
    box.hidden = false;
    return;
  }

  addTroubleshootLi(list, "Unexpected HTTP " + status + ". Read the message above; then check Render logs for this API service.");
  addTroubleshootAdminLinkLi(list);
  box.hidden = false;
}

function showContactTroubleshootTimeout() {
  var list = document.getElementById("contactTroubleshootList");
  var box = document.getElementById("contactTroubleshoot");
  if (!list || !box) return;
  list.innerHTML = "";
  addTroubleshootLi(
    list,
    "The browser waited a long time and stopped waiting. That usually means the API on Render was cold, overloaded, or stuck inside mail sending."
  );
  addTroubleshootLi(
    list,
    "Try again in one minute. If it keeps happening: configure Resend on the API (faster than SMTP), redeploy, and confirm https://family-cash-flow-api.onrender.com responds in a new tab."
  );
  addTroubleshootAdminLinkLi(list);
  box.hidden = false;
}

function showContactTroubleshootNetwork() {
  var list = document.getElementById("contactTroubleshootList");
  var box = document.getElementById("contactTroubleshoot");
  if (!list || !box) return;
  list.innerHTML = "";
  addTroubleshootLi(
    list,
    "The browser could not talk to the API (network/CORS/offline). Confirm the site was built with the correct API_BASE (GitHub Actions secret) pointing at https://family-cash-flow-api.onrender.com."
  );
  addTroubleshootLi(
    list,
    "On Render: CORS_ORIGINS must include https://balancewhiz.com (origin only, no path). Redeploy the API after changing env vars."
  );
  addTroubleshootLi(list, "Open the API URL in a new tab; if it does not load, the service may be asleep (free tier) — wait and retry.");
  addTroubleshootAdminLinkLi(list);
  box.hidden = false;
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
    window.location.href = "/";
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

async function readErrorFromResponse(res) {
  var text = await res.text();
  var detail = text.slice(0, 600) || "Request failed.";
  try {
    var j = JSON.parse(text);
    if (j && typeof j.detail === "string") detail = j.detail;
    else if (j && j.detail != null) detail = JSON.stringify(j.detail);
  } catch (_) {
    /* ignore */
  }
  return { status: res.status, detail: detail };
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
    hideContactTroubleshoot();

    const name = String((nameEl && nameEl.value) || "").trim();
    const email = String((emailEl && emailEl.value) || "").trim();
    const subject = String((subjectEl && subjectEl.value) || "").trim() || "General question";
    const msg = String((messageEl && messageEl.value) || "").trim();

    if (!name) {
      setErr(errEl, "Name is required.");
      hideContactTroubleshoot();
      return;
    }
    if (!email) {
      setErr(errEl, "Email is required.");
      hideContactTroubleshoot();
      return;
    }
    if (!msg) {
      setErr(errEl, "Message is required.");
      hideContactTroubleshoot();
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
        }, 36000);
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
          hideContactTroubleshoot();
          return;
        }
        if (res.status === 503) {
          showContactTroubleshootFromApi(503, "");
          openMailtoFallback(name, email, subject, msg);
          return;
        }
        var errInfo = await readErrorFromResponse(res);
        setErr(errEl, errInfo.detail);
        showContactTroubleshootFromApi(errInfo.status, errInfo.detail);
        return;
      }

      hideContactTroubleshoot();
      openMailtoFallback(name, email, subject, msg);
    } catch (err) {
      if (err && err.name === "AbortError") {
        setErr(
          errEl,
          "The server did not answer in time. Opening your email app instead — you can send the same message from there."
        );
        showContactTroubleshootTimeout();
      } else {
        setErr(
          errEl,
          "Could not reach the server from this page. Opening your email app instead — or try again after checking your connection."
        );
        showContactTroubleshootNetwork();
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
