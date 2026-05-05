(function () {
  function apiBaseUrl() {
    const raw = window.API_BASE && window.API_BASE !== "__API_BASE__" ? String(window.API_BASE).trim() : "";
    return raw.replace(/\/+$/, "");
  }

  function isLocalhostHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  }

  function formatApiDetail(detail) {
    if (detail == null) return "";
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const parts = [];
      for (const item of detail) {
        if (typeof item === "string") {
          parts.push(item);
          continue;
        }
        if (item && typeof item === "object") {
          const loc = Array.isArray(item.loc) ? item.loc.filter((x) => x !== "body").join(".") : "";
          const m = item.msg != null ? String(item.msg) : "";
          if (loc && m) parts.push(`${loc}: ${m}`);
          else if (m) parts.push(m);
        }
      }
      return parts.filter(Boolean).join("\n");
    }
    if (typeof detail === "object") {
      try {
        return JSON.stringify(detail);
      } catch (_) {
        return String(detail);
      }
    }
    return String(detail);
  }

  async function api(path, method, body) {
    const apiBase = apiBaseUrl();
    const fullPath = `${apiBase}${path}`;
    const hostname = typeof location !== "undefined" ? location.hostname : "";
    const origin = typeof location !== "undefined" ? location.origin : "(unknown)";
    const isLocalhost = isLocalhostHost(hostname);
    const isStaticWebHost = !isLocalhost && origin !== "(unknown)";
    if (!apiBase && isStaticWebHost) {
      throw new Error(
        "This page needs API_BASE (same as the main app). Configure it in your static deploy, then reload."
      );
    }
    const res = await fetch(fullPath, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      window.location.href = "../login.html";
      return null;
    }
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        if (data && data.detail != null) {
          const d = formatApiDetail(data.detail);
          if (d) msg = d;
        }
      } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function setCallout(el, msg, mode) {
    if (!el) return;
    el.textContent = msg || "";
    el.className = mode ? `callout callout--${mode}` : "callout";
    el.style.display = msg ? "block" : "none";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function activateSection(key) {
    const k = String(key || "overview");
    document.querySelectorAll(".platform-admin-nav__btn[data-admin-section]").forEach((btn) => {
      const on = btn.dataset.adminSection === k;
      btn.classList.toggle("is-active", on && !btn.disabled);
    });
    document.querySelectorAll(".admin-section").forEach((sec) => {
      const id = sec.id || "";
      const on = id === `adminSection${k.charAt(0).toUpperCase()}${k.slice(1)}`;
      sec.hidden = !on;
      sec.classList.toggle("is-active", on);
    });
  }

  async function loadOverview() {
    const data = await api("/api/platform/overview", "GET");
    const el = document.getElementById("adminOverviewText");
    if (el && data && data.message) el.textContent = data.message;
  }

  async function loadFamiliesList() {
    const mount = document.getElementById("adminFamiliesMount");
    if (!mount) return;
    const rows = await api("/api/platform/families", "GET");
    if (!rows || !rows.length) {
      mount.innerHTML = '<p class="meta">No families yet.</p>';
      return;
    }
    const lines = rows.map((f) => `<li><strong>${escapeHtml(f.name)}</strong> <span class="meta">#${f.id}</span></li>`);
    mount.innerHTML = `<ul class="meta" style="margin:0;padding-left:1.2rem">${lines.join("")}</ul>`;
  }

  async function loadUsers() {
    const mount = document.getElementById("adminUsersMount");
    if (!mount) return;
    const users = await api("/api/platform/users", "GET");
    if (!users || !users.length) {
      mount.innerHTML = '<p class="meta">No users.</p>';
      return;
    }
    mount.innerHTML = "";
    for (const u of users) {
      const card = document.createElement("div");
      card.className = "admin-user-card";
      const h = document.createElement("h3");
      h.textContent = u.email;
      card.appendChild(h);
      const sub = document.createElement("div");
      sub.className = "meta";
      sub.textContent = `User #${u.id}${u.name ? ` · ${u.name}` : ""}`;
      card.appendChild(sub);

      const memList = u.memberships || [];
      if (!memList.length) {
        const empty = document.createElement("div");
        empty.className = "meta";
        empty.textContent = "No family memberships.";
        card.appendChild(empty);
      } else {
        for (const m of memList) {
          const row = document.createElement("div");
          row.className = "admin-membership";
          const title = document.createElement("div");
          const bold = document.createElement("strong");
          bold.textContent = m.family_name;
          title.appendChild(bold);
          const span = document.createElement("span");
          span.className = "meta";
          span.textContent = ` (#${m.family_id})`;
          title.appendChild(span);
          row.appendChild(title);
          const tools = document.createElement("div");
          tools.className = "admin-inline-actions";
          const sel = document.createElement("select");
          sel.setAttribute("aria-label", `Access for ${u.email} on family ${m.family_id}`);
          for (const opt of [
            { v: "edit", t: "Can edit" },
            { v: "view", t: "View only" },
          ]) {
            const o = document.createElement("option");
            o.value = opt.v;
            o.textContent = opt.t;
            if (String(m.access_mode || "edit").toLowerCase() === opt.v) o.selected = true;
            sel.appendChild(o);
          }
          const saveAcc = document.createElement("button");
          saveAcc.type = "button";
          saveAcc.textContent = "Save access";
          saveAcc.addEventListener("click", async () => {
            const callout = document.getElementById("adminCallout");
            try {
              setCallout(callout, "Saving…", "pending");
              await api(`/api/platform/families/${m.family_id}/members/${u.id}`, "PATCH", {
                access_mode: sel.value,
              });
              setCallout(callout, "Membership updated.", "ok");
              await loadUsers();
            } catch (e) {
              setCallout(callout, (e && e.message) || String(e), "error");
            }
          });
          const ownBtn = document.createElement("button");
          ownBtn.type = "button";
          ownBtn.textContent = "Make family owner";
          ownBtn.addEventListener("click", async () => {
            if (!window.confirm(`Make ${u.email} the owner of family "${m.family_name}"?`)) return;
            const callout = document.getElementById("adminCallout");
            try {
              setCallout(callout, "Saving…", "pending");
              await api(`/api/platform/families/${m.family_id}/members/${u.id}`, "PATCH", {
                is_family_owner: true,
              });
              setCallout(callout, "Owner updated.", "ok");
              await loadUsers();
            } catch (e) {
              setCallout(callout, (e && e.message) || String(e), "error");
            }
          });
          tools.appendChild(sel);
          tools.appendChild(saveAcc);
          if (!m.is_family_owner) tools.appendChild(ownBtn);
          row.appendChild(tools);
          card.appendChild(row);
        }
      }

      const pwId = `pw_${u.id}`;
      const pwRow = document.createElement("div");
      pwRow.className = "admin-inline-actions";
      pwRow.innerHTML = `<input type="password" id="${pwId}" autocomplete="new-password" placeholder="New password" />`;
      const setPw = document.createElement("button");
      setPw.type = "button";
      setPw.textContent = "Set password";
      setPw.className = "admin-set-pw";
      setPw.addEventListener("click", async () => {
        const input = document.getElementById(pwId);
        const pw = input ? String(input.value || "") : "";
        const callout = document.getElementById("adminCallout");
        if (pw.length < 8) {
          setCallout(callout, "Password must be at least 8 characters.", "error");
          return;
        }
        try {
          setCallout(callout, "Saving…", "pending");
          await api(`/api/platform/users/${u.id}/password`, "POST", { new_password: pw });
          if (input) input.value = "";
          setCallout(callout, "Password updated.", "ok");
        } catch (e) {
          setCallout(callout, (e && e.message) || String(e), "error");
        }
      });
      pwRow.appendChild(setPw);
      card.appendChild(pwRow);

      const dangerRow = document.createElement("div");
      dangerRow.className = "admin-inline-actions";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.textContent = "Delete user";
      delBtn.addEventListener("click", async () => {
        if (!window.confirm(`Delete user ${u.email}?\n\nThis permanently removes the user and related records they created.`)) return;
        const callout = document.getElementById("adminCallout");
        try {
          setCallout(callout, "Deleting…", "pending");
          await api(`/api/platform/users/${u.id}`, "DELETE");
          setCallout(callout, "User deleted.", "ok");
          await loadUsers();
        } catch (e) {
          setCallout(callout, (e && e.message) || String(e), "error");
        }
      });
      dangerRow.appendChild(delBtn);
      card.appendChild(dangerRow);
      mount.appendChild(card);
    }
  }

  const platformAdminBackBtn = document.getElementById("platformAdminBackBtn");
  if (platformAdminBackBtn) {
    platformAdminBackBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      try {
        const ref = document.referrer;
        if (ref && new URL(ref).origin === window.location.origin) {
          window.location.assign(ref);
          return;
        }
      } catch (_) {}
      window.location.assign("/calendar");
    });
  }

  document.querySelectorAll(".platform-admin-nav__btn[data-admin-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const k = btn.getAttribute("data-admin-section");
      if (!k) return;
      activateSection(k);
      if (k === "users") loadUsers().catch((e) => setCallout(document.getElementById("adminCallout"), e.message, "error"));
      if (k === "families")
        loadFamiliesList().catch((e) => setCallout(document.getElementById("adminCallout"), e.message, "error"));
    });
  });

  async function boot() {
    const callout = document.getElementById("adminCallout");
    try {
      const me = await api("/api/auth/me", "GET");
      if (!me || !me.user) {
        window.location.href = "../login.html";
        return;
      }
      if (!me.is_platform_admin) {
        setCallout(callout, "Your account is not a platform administrator.", "error");
        return;
      }
      await loadOverview();
      setCallout(callout, "", "");
    } catch (e) {
      setCallout(callout, (e && e.message) || String(e), "error");
    }
  }

  boot();
})();
