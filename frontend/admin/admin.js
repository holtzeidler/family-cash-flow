(function () {
  function apiBase() {
    const raw =
      window.API_BASE && window.API_BASE !== "__API_BASE__" ? String(window.API_BASE).trim() : "";
    return raw.replace(/\/$/, "");
  }

  function setOut(text, isError) {
    const pre = document.getElementById("adminApiOut");
    const err = document.getElementById("adminApiErr");
    if (!pre || !err) return;
    err.style.display = "none";
    err.textContent = "";
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

  async function checkApi() {
    const base = apiBase();
    if (!base) {
      setOut(
        "API base URL is not configured. Open this site from your deployed host or set API_BASE when building static files.",
        true
      );
      return;
    }
    setOut("Loading…", false);
    try {
      const res = await fetch(base + "/api/debug/public-config", { credentials: "omit" });
      const body = await res.text();
      let pretty = body;
      try {
        pretty = JSON.stringify(JSON.parse(body), null, 2);
      } catch (_) {
        /* keep raw */
      }
      if (!res.ok) {
        setOut("HTTP " + res.status + "\n\n" + pretty, true);
        return;
      }
      setOut(pretty, false);
    } catch (e) {
      setOut(String(e && e.message ? e.message : e), true);
    }
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
