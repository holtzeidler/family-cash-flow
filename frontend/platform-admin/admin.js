(function () {
  function apiBaseUrl() {
    const raw = window.API_BASE && window.API_BASE !== "__API_BASE__" ? String(window.API_BASE).trim() : "";
    return raw.replace(/\/+$/, "");
  }

  const BW_API_ACCESS_TOKEN_KEY = "bw_api_access_token";

  function apiBearerAuthHeaders() {
    try {
      const t = sessionStorage.getItem(BW_API_ACCESS_TOKEN_KEY);
      if (t && String(t).trim()) return { Authorization: `Bearer ${String(t).trim()}` };
    } catch (_) {}
    return {};
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
      headers: {
        ...apiBearerAuthHeaders(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      try {
        sessionStorage.removeItem(BW_API_ACCESS_TOKEN_KEY);
      } catch (_) {}
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

  /** @type {any[]|null} */
  let cachedPlatformUsers = null;

  function platformUserSearchBlob(u) {
    const parts = [u.email, u.name, String(u.id)];
    for (const m of u.memberships || []) {
      parts.push(m.family_name, String(m.family_id));
    }
    return parts
      .filter((x) => x != null && String(x).trim() !== "")
      .join("\n")
      .toLowerCase();
  }

  function platformUserMatchesQuery(u, q) {
    const raw = String(q || "").trim().toLowerCase();
    if (!raw) return true;
    const blob = platformUserSearchBlob(u);
    const tokens = raw.split(/\s+/).filter(Boolean);
    return tokens.every((t) => blob.includes(t));
  }

  function wirePlatformUserSearch() {
    const input = document.getElementById("adminUsersSearch");
    if (!input || input.dataset.bwWired === "1") return;
    input.dataset.bwWired = "1";
    input.addEventListener("input", () => {
      if (!cachedPlatformUsers) return;
      renderPlatformUserCards(cachedPlatformUsers);
    });
  }

  function renderPlatformUserCards(users) {
    const mount = document.getElementById("adminUsersMount");
    if (!mount) return;
    const searchEl = document.getElementById("adminUsersSearch");
    const query = searchEl ? String(searchEl.value || "") : "";
    const filtered = users.filter((u) => platformUserMatchesQuery(u, query));
    if (!users.length) {
      mount.innerHTML = '<p class="meta">No users.</p>';
      return;
    }
    if (!filtered.length) {
      mount.innerHTML = '<p class="meta">No users match your search.</p>';
      return;
    }
    mount.innerHTML = "";
    for (const u of filtered) {
      const card = document.createElement("div");
      card.className = "admin-user-card";
      card.dataset.userCard = "1";
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
      // Place Delete user at upper-right of the card.
      delBtn.classList.add("admin-user-card__delete");
      card.appendChild(delBtn);
      card.appendChild(dangerRow);
      mount.appendChild(card);
    }
  }

  async function loadUsers() {
    const mount = document.getElementById("adminUsersMount");
    if (!mount) return;
    wirePlatformUserSearch();
    const users = await api("/api/platform/users", "GET");
    cachedPlatformUsers = Array.isArray(users) ? users : [];
    renderPlatformUserCards(cachedPlatformUsers);
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
      if (k === "feedback")
        loadFeedback().catch((e) => setCallout(document.getElementById("adminCallout"), e.message, "error"));
    });
  });

  // -------------------------------------------------------------------
  // Feedback review section
  // -------------------------------------------------------------------

  const FB_KIND_LABEL = { bug: "Bug / feedback", reaction: "Reaction", pulse: "Pulse" };

  function fmtFeedbackTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch (_) {
      return String(iso || "");
    }
  }

  function getApiBaseForLinks() {
    return apiBaseUrl();
  }

  async function loadFeedback() {
    const mount = document.getElementById("adminFbMount");
    const metaEl = document.getElementById("adminFbMeta");
    if (!mount) return;
    const kind = (document.getElementById("adminFbKind") || {}).value || "";
    const status_ = (document.getElementById("adminFbStatus") || {}).value || "";
    const category = (document.getElementById("adminFbCategory") || {}).value || "";
    const q = (document.getElementById("adminFbSearch") || {}).value || "";
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (status_) params.set("status", status_);
    if (category) params.set("category", category);
    if (q) params.set("q", q);
    params.set("limit", "200");

    mount.innerHTML = '<p class="admin-feedback-empty">Loading…</p>';
    if (metaEl) metaEl.textContent = "";
    let data;
    try {
      data = await api(`/api/admin/feedback?${params.toString()}`, "GET");
    } catch (err) {
      const raw = err && err.message ? String(err.message) : "";
      // Production has occasionally served the older build that predates the
      // feedback endpoints. Detect that specifically and tell the operator
      // exactly what to do, rather than leaving a stuck "Loading…" and a
      // bare "Not Found" callout that looks like a real bug.
      const isMissingEndpoint = /not found/i.test(raw) || /\(404\)/.test(raw);
      if (isMissingEndpoint) {
        mount.innerHTML =
          '<p class="admin-feedback-empty">Feedback endpoint isn’t available on this backend yet.</p>';
        throw new Error(
          "Feedback endpoints aren’t deployed yet. Trigger a manual redeploy of family-cash-flow-api in the Render dashboard, then retry."
        );
      }
      mount.innerHTML = '<p class="admin-feedback-empty">Couldn’t load feedback. Try again in a moment.</p>';
      throw err;
    }
    const items = (data && data.items) || [];
    if (metaEl) metaEl.textContent = `${data.total || 0} match${(data.total || 0) === 1 ? "" : "es"}`;

    if (!items.length) {
      mount.innerHTML = '<p class="admin-feedback-empty">No feedback matches these filters.</p>';
      return;
    }

    mount.innerHTML = "";
    for (const item of items) {
      mount.appendChild(renderFeedbackCard(item));
    }
  }

  function renderFeedbackCard(item) {
    const card = document.createElement("article");
    card.className = "admin-feedback-card";
    card.dataset.kind = item.kind;
    card.dataset.id = String(item.id);

    const head = document.createElement("div");
    head.className = "admin-feedback-card__head";
    head.innerHTML = `
      <span class="admin-feedback-card__kind">
        <span class="admin-feedback-card__kind-dot" aria-hidden="true"></span>
        ${escapeHtml(FB_KIND_LABEL[item.kind] || item.kind)}
        ${item.category ? ` · ${escapeHtml(item.category)}` : ""}
      </span>
      <span class="admin-feedback-card__time" title="${escapeHtml(item.created_at)}">${escapeHtml(fmtFeedbackTime(item.created_at))}</span>
    `;
    card.appendChild(head);

    // Title / content body varies by kind.
    if (item.kind === "bug") {
      const title = document.createElement("h3");
      title.className = "admin-feedback-card__title";
      title.textContent = item.what_trying || item.what_happened || "(no description)";
      card.appendChild(title);
      if (item.what_happened) {
        const body = document.createElement("div");
        body.className = "admin-feedback-card__body";
        body.textContent = item.what_happened;
        card.appendChild(body);
      }
    } else if (item.kind === "reaction") {
      const title = document.createElement("h3");
      title.className = "admin-feedback-card__title";
      title.textContent = `${item.rating === "up" ? "👍 Useful" : "👎 Not useful"} — ${item.context_key || "(no context)"}`;
      card.appendChild(title);
      if (item.comment) {
        const body = document.createElement("div");
        body.className = "admin-feedback-card__body";
        body.textContent = item.comment;
        card.appendChild(body);
      }
    } else if (item.kind === "pulse") {
      const title = document.createElement("h3");
      title.className = "admin-feedback-card__title";
      title.textContent = `${item.prompt_id || "pulse"} — ${item.rating || "(no rating)"}`;
      card.appendChild(title);
      if (item.comment) {
        const body = document.createElement("div");
        body.className = "admin-feedback-card__body";
        body.textContent = item.comment;
        card.appendChild(body);
      }
    }

    const meta = document.createElement("div");
    meta.className = "admin-feedback-card__meta";
    const bits = [];
    bits.push(
      `<span><strong>User:</strong> ${item.user_email ? escapeHtml(item.user_email) : "—"}${item.user_name ? ` (${escapeHtml(item.user_name)})` : ""}</span>`
    );
    if (item.contact_email && item.contact_email !== item.user_email) {
      bits.push(`<span><strong>Reply to:</strong> ${escapeHtml(item.contact_email)}</span>`);
    }
    if (item.route) bits.push(`<span><strong>Route:</strong> ${escapeHtml(item.route)}</span>`);
    if (item.view) bits.push(`<span><strong>View:</strong> ${escapeHtml(item.view)}</span>`);
    if (item.forecast_month) bits.push(`<span><strong>Month:</strong> ${escapeHtml(item.forecast_month)}</span>`);
    if (item.viewport) bits.push(`<span><strong>Viewport:</strong> ${escapeHtml(item.viewport)}</span>`);
    if (item.browser_ua) bits.push(`<span><strong>UA:</strong> ${escapeHtml(item.browser_ua)}</span>`);
    meta.innerHTML = bits.join("");
    card.appendChild(meta);

    if (item.has_screenshot) {
      const sw = document.createElement("div");
      sw.className = "admin-feedback-card__screenshot";
      const img = document.createElement("img");
      const base = getApiBaseForLinks();
      img.src = `${base}/api/admin/feedback/${item.id}/screenshot`;
      img.alt = `Screenshot for feedback #${item.id}`;
      img.loading = "lazy";
      // Image fetch needs the bearer token; modern browsers don't allow custom
      // headers on <img>. Workaround: fetch + objectURL.
      void fetch(img.src, { headers: apiBearerAuthHeaders(), credentials: "include" })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (blob) img.src = URL.createObjectURL(blob);
        })
        .catch(() => {});
      sw.appendChild(img);
      card.appendChild(sw);
    }

    // Inline admin actions
    const actions = document.createElement("div");
    actions.className = "admin-feedback-card__actions";

    const statusSel = document.createElement("select");
    for (const s of ["new", "in_progress", "resolved"]) {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s.replace("_", " ");
      if (item.status === s) opt.selected = true;
      statusSel.appendChild(opt);
    }
    statusSel.setAttribute("aria-label", "Status");
    actions.appendChild(labeled("Status", statusSel));

    const catSel = document.createElement("select");
    const catOpts = ["", "Bug", "UX confusion", "Feature request", "Praise"];
    for (const c of catOpts) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c || "—";
      if ((item.category || "") === c) opt.selected = true;
      catSel.appendChild(opt);
    }
    catSel.setAttribute("aria-label", "Category");
    actions.appendChild(labeled("Category", catSel));

    const notes = document.createElement("textarea");
    notes.rows = 1;
    notes.placeholder = "Admin notes…";
    notes.value = item.admin_notes || "";
    notes.setAttribute("aria-label", "Admin notes");
    actions.appendChild(notes);

    const save = document.createElement("button");
    save.type = "button";
    save.className = "admin-feedback-card__save";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await api(`/api/admin/feedback/${item.id}`, "PATCH", {
          status: statusSel.value,
          category: catSel.value || "",
          admin_notes: notes.value,
        });
        item.status = statusSel.value;
        item.category = catSel.value || null;
        item.admin_notes = notes.value;
        save.textContent = "Saved";
        setTimeout(() => (save.textContent = "Save"), 1400);
      } catch (e) {
        save.textContent = "Retry";
        const cb = document.getElementById("adminCallout");
        if (cb) setCallout(cb, (e && e.message) || "Save failed", "error");
      } finally {
        save.disabled = false;
      }
    });
    actions.appendChild(save);

    card.appendChild(actions);
    return card;
  }

  function labeled(label, control) {
    const wrap = document.createElement("label");
    wrap.style.display = "inline-flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "2px";
    wrap.style.fontSize = "11px";
    wrap.style.color = "var(--muted)";
    wrap.appendChild(document.createTextNode(label));
    wrap.appendChild(control);
    return wrap;
  }

  // Wire filter inputs (admin.js is loaded at end of body, so the inputs
  // already exist by this point).
  {
    const refresh = () => {
      loadFeedback().catch((e) => {
        const cb = document.getElementById("adminCallout");
        if (cb) setCallout(cb, (e && e.message) || "Could not load feedback.", "error");
      });
    };
    const ids = ["adminFbKind", "adminFbStatus", "adminFbCategory"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", refresh);
    });
    const search = document.getElementById("adminFbSearch");
    if (search) {
      let t = null;
      search.addEventListener("input", () => {
        if (t) clearTimeout(t);
        t = setTimeout(refresh, 300);
      });
    }
    const refreshBtn = document.getElementById("adminFbRefresh");
    if (refreshBtn) refreshBtn.addEventListener("click", refresh);
  }

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

  wirePlatformUserSearch();

  boot();
})();
