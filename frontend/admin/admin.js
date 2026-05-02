(function () {
  /** Shown in help text; live requests still use `window.API_BASE` from the GitHub Pages build. */
  var BW_HOME = "https://balancewhiz.com";
  var BW_API_PUBLIC = "https://family-cash-flow-api.onrender.com";

  function apiBase() {
    const raw =
      window.API_BASE && window.API_BASE !== "__API_BASE__" ? String(window.API_BASE).trim() : "";
    return raw.replace(/\/$/, "");
  }

  function publicConfigUrl() {
    const base = apiBase();
    return base ? base + "/api/debug/public-config" : "";
  }

  function buildContactCurl() {
    const base = apiBase();
    if (!base) {
      return (
        "# API_BASE is not set in this GitHub Pages build.\n" +
        "# GitHub → repo → Settings → Secrets → Actions → set API_BASE = " +
        BW_API_PUBLIC +
        "\n# (no trailing slash). Re-run the Deploy workflow, reload this page, then copy the curl below again."
      );
    }
    return (
      "curl -sS -X POST '" +
      base +
      "/api/public/contact' \\\n" +
      "  -H 'Content-Type: application/json' \\\n" +
      "  -d '{\"name\":\"API test\",\"email\":\"test@balancewhiz.com\",\"subject\":\"Admin curl test\",\"message\":\"If support@ receives this, server email works.\"}'"
    );
  }

  function syncStaticDisplays() {
    const base = apiBase();
    const urlEl = document.getElementById("adminApiUrlDisplay");
    const missingEl = document.getElementById("adminApiBaseMissing");
    const curlBox = document.getElementById("adminCurlBox");
    if (urlEl) {
      urlEl.textContent = publicConfigUrl() || "(no API URL — see warning below)";
    }
    if (missingEl) {
      missingEl.hidden = !!base;
    }
    if (curlBox) {
      curlBox.value = buildContactCurl();
    }
  }

  function clearApiSummary() {
    const sum = document.getElementById("adminApiSummary");
    const rawLabel = document.getElementById("adminApiRawLabel");
    if (sum) {
      sum.hidden = true;
      sum.innerHTML = "";
    }
    if (rawLabel) rawLabel.hidden = true;
  }

  function setOut(text, isError) {
    const pre = document.getElementById("adminApiOut");
    const err = document.getElementById("adminApiErr");
    if (!pre || !err) return;
    err.style.display = "none";
    err.textContent = "";
    clearApiSummary();
    if (isError) {
      pre.hidden = true;
      pre.textContent = "";
      err.style.display = "block";
      err.textContent = text;
      return;
    }
    pre.hidden = false;
    pre.textContent = text;
  }

  function renderApiSummary(data) {
    const sum = document.getElementById("adminApiSummary");
    const rawLabel = document.getElementById("adminApiRawLabel");
    if (!sum) return;
    sum.innerHTML = "";

    const title = document.createElement("div");
    title.className = "admin-api-summary__title";
    title.textContent = "What this means (plain English)";
    sum.appendChild(title);

    const ul = document.createElement("ul");
    ul.className = "admin-api-summary__list";

    function addLi(strongLabel, bodyText, ok) {
      const li = document.createElement("li");
      const mark = document.createElement("span");
      mark.className = "admin-api-summary__mark" + (ok === false ? " is-bad" : ok === true ? " is-good" : "");
      mark.textContent = ok === true ? "OK — " : ok === false ? "Fix — " : "";
      li.appendChild(mark);
      const rest = document.createElement("span");
      const s = document.createElement("strong");
      s.textContent = strongLabel + " ";
      rest.appendChild(s);
      rest.appendChild(document.createTextNode(bodyText));
      li.appendChild(rest);
      ul.appendChild(li);
    }

    const env = data.env != null ? String(data.env) : "unknown";
    addLi("Server environment:", "The API reports ENV=" + env + " (production is normal on Render).", null);

    const corsOk = !!data.cors_middleware_enabled;
    const corsHint = typeof data.cors_hint === "string" ? data.cors_hint : "";
    const origins = Array.isArray(data.cors_allow_origins) ? data.cors_allow_origins.join(", ") : "";
    addLi(
      "Browser access (CORS):",
      corsOk
        ? (corsHint || "Cross-origin requests from your listed site(s) are allowed.") +
            (origins ? " Allowed origins: " + origins + "." : "")
        : (corsHint ||
            "The API is not allowing browser calls from your site (e.g. " +
            BW_HOME +
            ") until CORS_ORIGINS on Render includes that origin."),
      corsOk
    );

    const contactOk = !!data.contact_form_enabled;
    const ch = typeof data.contact_form_hint === "string" ? data.contact_form_hint : "";
    addLi(
      "Contact form (server email):",
      contactOk ? (ch || "The server can send contact mail.") : (ch || "Contact mail is not fully configured on the server."),
      contactOk
    );
    var delivery = typeof data.contact_form_delivery === "string" ? data.contact_form_delivery : "";
    if (contactOk && delivery) {
      var dBody =
        delivery === "resend"
          ? "Resend over HTTPS (recommended on Render)."
          : delivery === "smtp"
            ? "SMTP only — often slow or blocked from cloud hosts; add Resend if you see timeouts."
            : "Mode: " + delivery + ".";
      addLi("Contact delivery path:", dBody, delivery === "resend" ? true : null);
    }

    const ck =
      "Cookies for login: SameSite=" +
      String(data.auth_cookie_samesite || "?") +
      ", Secure=" +
      String(data.auth_cookie_secure);
    addLi("Auth cookies:", ck + " (production + Secure is required for GitHub Pages + Render).", null);

    sum.appendChild(ul);
    sum.hidden = false;
    if (rawLabel) rawLabel.hidden = false;
  }

  async function checkApi() {
    const base = apiBase();
    if (!base) {
      setOut("", true);
      const err = document.getElementById("adminApiErr");
      if (err) {
        err.style.display = "block";
        err.textContent =
          "This page does not know your API URL yet. In GitHub: open your repo → Settings → Secrets and variables → Actions → set API_BASE to " +
          BW_API_PUBLIC +
          " (no trailing slash) for BalanceWhiz. Push a small change or re-run the “Deploy frontend to GitHub Pages” workflow, then reload this admin page (e.g. " +
          BW_HOME +
          "/admin/).";
      }
      return;
    }
    setOut("Loading…", false);
    try {
      const url = publicConfigUrl();
      const res = await fetch(url, { credentials: "omit" });
      const body = await res.text();
      let parsed = null;
      let pretty = body;
      try {
        parsed = JSON.parse(body);
        pretty = JSON.stringify(parsed, null, 2);
      } catch (_) {
        /* keep raw */
      }
      if (!res.ok) {
        clearApiSummary();
        const pre = document.getElementById("adminApiOut");
        const err = document.getElementById("adminApiErr");
        const rawLabel = document.getElementById("adminApiRawLabel");
        if (rawLabel) rawLabel.hidden = false;
        if (pre) {
          pre.hidden = false;
          pre.textContent = pretty;
        }
        if (err) {
          err.style.display = "block";
          err.textContent =
            "The request failed with HTTP " +
            res.status +
            ". The gray box below is the raw response (if any). Next: click “Open in new tab” on the Full check URL above — if that tab also shows an error, your API URL is wrong or the server is down. If the tab shows JSON but this page failed, check mixed content (page is https but API is http) or a browser extension.";
        }
        return;
      }
      setOut(pretty, false);
      if (parsed && typeof parsed === "object") {
        renderApiSummary(parsed);
      }
    } catch (e) {
      setOut("", true);
      const err = document.getElementById("adminApiErr");
      if (err) {
        err.style.display = "block";
        err.textContent =
          "The browser could not complete the request. Typical causes: wrong API_BASE, API offline, or corporate Wi‑Fi blocking. Details: " +
          String(e && e.message ? e.message : e);
      }
    }
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {},
        function () {
          window.prompt("Copy:", text);
        }
      );
    } else {
      window.prompt("Copy:", text);
    }
  }

  syncStaticDisplays();

  const copyUrlBtn = document.getElementById("adminCopyApiUrlBtn");
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener("click", function () {
      const u = publicConfigUrl();
      if (u) copyText(u);
    });
  }
  const openUrlBtn = document.getElementById("adminOpenApiUrlBtn");
  if (openUrlBtn) {
    openUrlBtn.addEventListener("click", function () {
      const u = publicConfigUrl();
      if (u) window.open(u, "_blank", "noopener,noreferrer");
    });
  }
  const copyCurlBtn = document.getElementById("adminCopyCurlBtn");
  if (copyCurlBtn) {
    copyCurlBtn.addEventListener("click", function () {
      const box = document.getElementById("adminCurlBox");
      if (box && box.value) copyText(box.value);
    });
  }

  function showUsersErr(msg) {
    const el = document.getElementById("adminUsersErr");
    if (!el) return;
    if (msg) {
      el.style.display = "block";
      el.textContent = msg;
    } else {
      el.style.display = "none";
      el.textContent = "";
    }
  }

  function formatCreated(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return String(iso);
    }
  }

  async function loadUsers() {
    const base = apiBase();
    const tokenInput = document.getElementById("adminMaintToken");
    const tbody = document.getElementById("adminUsersTbody");
    const wrap = document.getElementById("adminUsersTableWrap");
    const emptyEl = document.getElementById("adminUsersEmpty");
    if (!tokenInput || !tbody || !wrap || !emptyEl) return;

    showUsersErr("");
    emptyEl.style.display = "none";
    wrap.hidden = true;
    tbody.innerHTML = "";

    if (!base) {
      showUsersErr(
        "API base URL is not configured. Deploy with API_BASE set or open from your hosted app."
      );
      return;
    }
    const token = String(tokenInput.value || "").trim();
    if (!token) {
      showUsersErr("Enter the maintenance token first.");
      return;
    }

    try {
      const res = await fetch(base + "/api/maintenance/users", {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        credentials: "omit",
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
      if (!res.ok) {
        const detail =
          data && typeof data === "object" && data.detail != null
            ? typeof data.detail === "string"
              ? data.detail
              : JSON.stringify(data.detail)
            : text.slice(0, 400);
        showUsersErr("HTTP " + res.status + (detail ? ": " + detail : ""));
        return;
      }
      if (!Array.isArray(data)) {
        showUsersErr("Unexpected response from server.");
        return;
      }
      if (data.length === 0) {
        emptyEl.style.display = "block";
        return;
      }
      for (const row of data) {
        const tr = document.createElement("tr");
        const tdId = document.createElement("td");
        tdId.className = "num";
        tdId.textContent = row.id != null ? String(row.id) : "";
        const tdEmail = document.createElement("td");
        tdEmail.className = "admin-user-email";
        tdEmail.textContent = row.email != null ? String(row.email) : "";
        const tdName = document.createElement("td");
        tdName.textContent =
          row.name != null && String(row.name).trim() !== "" ? String(row.name) : "—";
        const tdCreated = document.createElement("td");
        tdCreated.textContent = formatCreated(row.created_at);
        tr.appendChild(tdId);
        tr.appendChild(tdEmail);
        tr.appendChild(tdName);
        tr.appendChild(tdCreated);
        tbody.appendChild(tr);
      }
      wrap.hidden = false;
    } catch (e) {
      showUsersErr(String(e && e.message ? e.message : e));
    }
  }

  const btn = document.getElementById("adminCheckApiBtn");
  if (btn) btn.addEventListener("click", checkApi);

  const loadUsersBtn = document.getElementById("adminLoadUsersBtn");
  if (loadUsersBtn) loadUsersBtn.addEventListener("click", loadUsers);
})();
