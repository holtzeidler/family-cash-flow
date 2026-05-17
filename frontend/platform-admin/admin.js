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
  /** @type {any[]|null} */
  let cachedPlatformFamilies = null;
  /** @type {number|null} */
  let openDrawerUserId = null;

  function fmtAdminDateTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return String(iso);
    }
  }

  function membershipFamilyRoleLabel(m) {
    if (m.is_family_owner) return "Owner";
    if (String(m.access_mode || "edit").toLowerCase() === "view") return "View only";
    return "Can edit";
  }

  function membershipToFamilyRoleValue(m) {
    if (m.is_family_owner) return "owner";
    if (String(m.access_mode || "edit").toLowerCase() === "view") return "view";
    return "edit";
  }

  function platformRoleLabel(role) {
    const r = String(role || "none").toLowerCase();
    if (r === "admin") return "Admin";
    if (r === "support") return "Support";
    return "None";
  }

  function statusLabel(status) {
    return String(status || "active") === "no_family" ? "No family" : "Active";
  }

  function familyCellText(u) {
    const mems = u.memberships || [];
    if (!mems.length) return "—";
    if (mems.length === 1) return mems[0].family_name;
    return `${mems[0].family_name} +${mems.length - 1}`;
  }

  function familyRoleCellText(u) {
    if (u.primary_family_role) return u.primary_family_role;
    const mems = u.memberships || [];
    if (!mems.length) return "—";
    if (mems.length === 1) return membershipFamilyRoleLabel(mems[0]);
    return "Multiple";
  }

  function platformUserSearchBlob(u) {
    const parts = [u.email, u.name, String(u.id), u.status, u.platform_role];
    for (const m of u.memberships || []) {
      parts.push(m.family_name, String(m.family_id), membershipFamilyRoleLabel(m));
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

  function getFilteredPlatformUsers() {
    const users = cachedPlatformUsers || [];
    const q = (document.getElementById("adminUsersSearch") || {}).value || "";
    const roleF = (document.getElementById("adminUsersFilterRole") || {}).value || "";
    const famF = (document.getElementById("adminUsersFilterFamily") || {}).value || "";
    const statusF = (document.getElementById("adminUsersFilterStatus") || {}).value || "";
    const platF = (document.getElementById("adminUsersFilterPlatformRole") || {}).value || "";

    return users.filter((u) => {
      if (!platformUserMatchesQuery(u, q)) return false;
      if (statusF && String(u.status) !== statusF) return false;
      if (platF && String(u.platform_role || "none") !== platF) return false;
      if (famF) {
        const fid = parseInt(famF, 10);
        if (!Number.isFinite(fid) || !(u.memberships || []).some((m) => m.family_id === fid)) return false;
      }
      if (roleF) {
        const mems = u.memberships || [];
        if (!mems.some((m) => membershipFamilyRoleLabel(m) === roleF)) return false;
      }
      return true;
    });
  }

  function populateUsersFamilyFilter() {
    const sel = document.getElementById("adminUsersFilterFamily");
    if (!sel) return;
    const prev = sel.value;
    const fams = cachedPlatformFamilies || [];
    sel.innerHTML = '<option value="">All</option>';
    for (const f of fams) {
      const o = document.createElement("option");
      o.value = String(f.id);
      o.textContent = `${f.name} (#${f.id})`;
      sel.appendChild(o);
    }
    if (prev) sel.value = prev;
  }

  function renderPlatformUsersTable() {
    const tbody = document.getElementById("adminUsersTableBody");
    const meta = document.getElementById("adminUsersMeta");
    const wrap = document.getElementById("adminUsersTableWrap");
    if (!tbody) return;

    const users = cachedPlatformUsers || [];
    const filtered = getFilteredPlatformUsers();

    if (meta) {
      if (!users.length) meta.textContent = "No users.";
      else if (!filtered.length) meta.textContent = "No users match the current filters.";
      else meta.textContent = `Showing ${filtered.length} of ${users.length} users`;
    }

    if (!users.length) {
      tbody.innerHTML = "";
      if (wrap) wrap.hidden = true;
      return;
    }
    if (wrap) wrap.hidden = false;

    if (!filtered.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="meta" style="text-align:center;padding:20px">No users match the current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((u) => {
        const nameLine = u.name ? escapeHtml(u.name) : escapeHtml(u.email);
        const emailSub =
          u.name && u.email ? `<span class="platform-admin-users-table__sub">${escapeHtml(u.email)}</span>` : "";
        return `<tr data-user-id="${u.id}">
          <td class="platform-admin-users-table__user">
            <span class="platform-admin-users-table__email">${nameLine}</span>
            ${emailSub}
            <span class="platform-admin-users-table__sub">#${u.id}</span>
          </td>
          <td>${escapeHtml(familyCellText(u))}</td>
          <td>${escapeHtml(familyRoleCellText(u))}</td>
          <td>${escapeHtml(platformRoleLabel(u.platform_role))}</td>
          <td>${escapeHtml(statusLabel(u.status))}</td>
          <td>${escapeHtml(fmtAdminDateTime(u.last_login_at))}</td>
          <td>${escapeHtml(fmtAdminDateTime(u.created_at))}</td>
          <td>
            <div class="platform-admin-users-actions">
              <button type="button" data-action="edit" data-user-id="${u.id}">View / edit</button>
              <button type="button" data-action="password" data-user-id="${u.id}">Reset password</button>
              <button type="button" class="danger" data-action="delete" data-user-id="${u.id}">Delete</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-user-id") || "", 10);
        const action = btn.getAttribute("data-action");
        if (!Number.isFinite(id)) return;
        if (action === "edit") openUserDrawer(id);
        else if (action === "password") quickResetPassword(id);
        else if (action === "delete") deletePlatformUser(id);
      });
    });
  }

  function wirePlatformUsersFilters() {
    const ids = [
      "adminUsersSearch",
      "adminUsersFilterRole",
      "adminUsersFilterFamily",
      "adminUsersFilterStatus",
      "adminUsersFilterPlatformRole",
    ];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el || el.dataset.bwWired === "1") continue;
      el.dataset.bwWired = "1";
      el.addEventListener("input", () => renderPlatformUsersTable());
      el.addEventListener("change", () => renderPlatformUsersTable());
    }
  }

  function setDrawerOpen(open) {
    const drawer = document.getElementById("adminUserDrawer");
    if (!drawer) return;
    drawer.hidden = !open;
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) openDrawerUserId = null;
  }

  async function openUserDrawer(userId) {
    const callout = document.getElementById("adminCallout");
    try {
      setCallout(callout, "Loading user…", "pending");
      const detail = await api(`/api/platform/users/${userId}`, "GET");
      if (!detail) return;
      openDrawerUserId = userId;
      renderUserDrawer(detail);
      setDrawerOpen(true);
      setCallout(callout, "", "");
    } catch (e) {
      setCallout(callout, (e && e.message) || String(e), "error");
    }
  }

  function renderUserDrawer(u) {
    const title = document.getElementById("adminUserDrawerTitle");
    const sub = document.getElementById("adminUserDrawerSub");
    const body = document.getElementById("adminUserDrawerBody");
    if (title) title.textContent = u.email;
    if (sub) sub.textContent = `User #${u.id}${u.name ? ` · ${u.name}` : ""}`;

    const mems = u.memberships || [];
    let membershipsHtml = '<p class="meta">No family memberships.</p>';
    if (mems.length) {
      membershipsHtml = mems
        .map((m) => {
          const roleVal = membershipToFamilyRoleValue(m);
          return `<div class="platform-admin-membership-row" data-family-id="${m.family_id}">
            <div class="platform-admin-membership-row__head">${escapeHtml(m.family_name)} <span class="meta">#${m.family_id}</span></div>
            <label class="platform-admin-drawer__field">
              <span>Family role <span class="meta">(in this family)</span></span>
              <select data-membership-role data-family-id="${m.family_id}" aria-label="Family role for ${escapeHtml(m.family_name)}">
                <option value="owner"${roleVal === "owner" ? " selected" : ""}>Owner</option>
                <option value="edit"${roleVal === "edit" ? " selected" : ""}>Can edit</option>
                <option value="view"${roleVal === "view" ? " selected" : ""}>View only</option>
              </select>
            </label>
            <button type="button" class="platform-admin-drawer__save" data-save-family-role data-family-id="${m.family_id}">Save family role</button>
          </div>`;
        })
        .join("");
    }

    const platRole = String(u.platform_role || "none").toLowerCase();
    const audit = (u.recent_audit || [])
      .map(
        (a) =>
          `<li><strong>${escapeHtml(a.action)}</strong> · ${escapeHtml(fmtAdminDateTime(a.created_at))}${
            a.actor_email ? ` · ${escapeHtml(a.actor_email)}` : ""
          }<br /><span>${escapeHtml(a.detail)}</span></li>`
      )
      .join("");

    if (body) {
      body.innerHTML = `
        <section class="platform-admin-drawer__section">
          <h4>Account</h4>
          <dl class="platform-admin-drawer__dl">
            <dt>Status</dt><dd>${escapeHtml(statusLabel(u.status))}</dd>
            <dt>Created</dt><dd>${escapeHtml(fmtAdminDateTime(u.created_at))}</dd>
            <dt>Last login</dt><dd>${escapeHtml(fmtAdminDateTime(u.last_login_at))}</dd>
          </dl>
        </section>
        <section class="platform-admin-drawer__section">
          <h4>Family memberships</h4>
          <p class="meta" style="margin:0 0 10px">Family roles control access inside a household account.</p>
          ${membershipsHtml}
        </section>
        <section class="platform-admin-drawer__section">
          <h4>Platform role</h4>
          <p class="meta" style="margin:0 0 10px">Grants access to this BalanceWhiz operator console (separate from family roles).</p>
          <label class="platform-admin-drawer__field">
            <span>Platform role</span>
            <select id="adminDrawerPlatformRole">
              <option value="none"${platRole === "none" ? " selected" : ""}>None</option>
              <option value="support"${platRole === "support" ? " selected" : ""}>Support</option>
              <option value="admin"${platRole === "admin" ? " selected" : ""}>Admin</option>
            </select>
          </label>
          <button type="button" class="platform-admin-drawer__save" id="adminDrawerSavePlatformRole">Save platform role</button>
        </section>
        <section class="platform-admin-drawer__section">
          <h4>Password reset</h4>
          <label class="platform-admin-drawer__field">
            <span>New password</span>
            <input type="password" id="adminDrawerPassword" autocomplete="new-password" minlength="8" />
          </label>
          <button type="button" class="platform-admin-drawer__save" id="adminDrawerSetPassword">Set password</button>
        </section>
        <section class="platform-admin-drawer__section">
          <h4>Recent activity</h4>
          <ul class="platform-admin-audit">${audit || "<li class='meta'>No audit entries yet.</li>"}</ul>
        </section>
        <section class="platform-admin-drawer__danger">
          <h4>Danger zone</h4>
          <p class="meta">Permanently delete this user and related records they created.</p>
          <button type="button" id="adminDrawerDeleteUser">Delete user</button>
        </section>`;
    }

    body.querySelectorAll("[data-save-family-role]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const fid = parseInt(btn.getAttribute("data-family-id") || "", 10);
        const sel = body.querySelector(`select[data-membership-role][data-family-id="${fid}"]`);
        const familyRole = sel ? sel.value : "edit";
        const callout = document.getElementById("adminCallout");
        if (familyRole === "owner" && !window.confirm(`Make ${u.email} the owner of this family?`)) return;
        try {
          setCallout(callout, "Saving…", "pending");
          await api(`/api/platform/families/${fid}/members/${u.id}/family-role`, "PATCH", { family_role: familyRole });
          setCallout(callout, "Family role updated.", "ok");
          await loadUsers();
          await openUserDrawer(u.id);
        } catch (e) {
          setCallout(callout, (e && e.message) || String(e), "error");
        }
      });
    });

    const savePlat = document.getElementById("adminDrawerSavePlatformRole");
    if (savePlat) {
      savePlat.addEventListener("click", async () => {
        const sel = document.getElementById("adminDrawerPlatformRole");
        const next = sel ? sel.value : "none";
        const callout = document.getElementById("adminCallout");
        if (
          next !== String(u.platform_role || "none") &&
          !window.confirm(`Change platform role to ${platformRoleLabel(next)} for ${u.email}?`)
        )
          return;
        try {
          setCallout(callout, "Saving…", "pending");
          await api(`/api/platform/users/${u.id}`, "PATCH", { platform_role: next });
          setCallout(callout, "Platform role updated.", "ok");
          await loadUsers();
          await openUserDrawer(u.id);
        } catch (e) {
          setCallout(callout, (e && e.message) || String(e), "error");
        }
      });
    }

    const setPw = document.getElementById("adminDrawerSetPassword");
    if (setPw) {
      setPw.addEventListener("click", () => submitDrawerPassword(u.id));
    }

    const del = document.getElementById("adminDrawerDeleteUser");
    if (del) {
      del.addEventListener("click", () => deletePlatformUser(u.id, true));
    }
  }

  async function submitDrawerPassword(userId) {
    const input = document.getElementById("adminDrawerPassword");
    const pw = input ? String(input.value || "") : "";
    const callout = document.getElementById("adminCallout");
    if (pw.length < 8) {
      setCallout(callout, "Password must be at least 8 characters.", "error");
      return;
    }
    if (!window.confirm("Set a new password for this user? They will need to use it on next sign-in.")) return;
    try {
      setCallout(callout, "Saving…", "pending");
      await api(`/api/platform/users/${userId}/password`, "POST", { new_password: pw });
      if (input) input.value = "";
      setCallout(callout, "Password updated.", "ok");
      if (openDrawerUserId === userId) await openUserDrawer(userId);
    } catch (e) {
      setCallout(callout, (e && e.message) || String(e), "error");
    }
  }

  async function quickResetPassword(userId) {
    const u = (cachedPlatformUsers || []).find((x) => x.id === userId);
    const email = u ? u.email : `user #${userId}`;
    const pw = window.prompt(`New password for ${email} (min 8 characters):`);
    if (pw == null) return;
    if (String(pw).length < 8) {
      setCallout(document.getElementById("adminCallout"), "Password must be at least 8 characters.", "error");
      return;
    }
    if (!window.confirm(`Set a new password for ${email}?`)) return;
    const callout = document.getElementById("adminCallout");
    try {
      setCallout(callout, "Saving…", "pending");
      await api(`/api/platform/users/${userId}/password`, "POST", { new_password: String(pw) });
      setCallout(callout, "Password updated.", "ok");
    } catch (e) {
      setCallout(callout, (e && e.message) || String(e), "error");
    }
  }

  async function deletePlatformUser(userId, fromDrawer) {
    const u = (cachedPlatformUsers || []).find((x) => x.id === userId);
    const email = u ? u.email : `user #${userId}`;
    if (
      !window.confirm(
        `Delete user ${email}?\n\nThis permanently removes the user and related records they created.`
      )
    )
      return;
    const callout = document.getElementById("adminCallout");
    try {
      setCallout(callout, "Deleting…", "pending");
      await api(`/api/platform/users/${userId}`, "DELETE");
      setCallout(callout, "User deleted.", "ok");
      if (fromDrawer) setDrawerOpen(false);
      await loadUsers();
    } catch (e) {
      setCallout(callout, (e && e.message) || String(e), "error");
    }
  }

  function wireUserDrawerChrome() {
    const close = () => setDrawerOpen(false);
    const backdrop = document.getElementById("adminUserDrawerBackdrop");
    const btn = document.getElementById("adminUserDrawerClose");
    if (backdrop && backdrop.dataset.bwWired !== "1") {
      backdrop.dataset.bwWired = "1";
      backdrop.addEventListener("click", close);
    }
    if (btn && btn.dataset.bwWired !== "1") {
      btn.dataset.bwWired = "1";
      btn.addEventListener("click", close);
    }
  }

  async function ensurePlatformFamiliesCache() {
    if (cachedPlatformFamilies) return cachedPlatformFamilies;
    const rows = await api("/api/platform/families", "GET");
    cachedPlatformFamilies = Array.isArray(rows) ? rows : [];
    return cachedPlatformFamilies;
  }

  function setInviteModalOpen(open) {
    const modal = document.getElementById("adminInviteModal");
    if (!modal) return;
    modal.hidden = !open;
    modal.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function wireInviteModal() {
    const openBtn = document.getElementById("adminUsersInviteBtn");
    const cancel = document.getElementById("adminInviteCancel");
    const backdrop = document.getElementById("adminInviteModalBackdrop");
    const form = document.getElementById("adminInviteForm");
    const familySel = document.getElementById("adminInviteFamily");

    const open = async () => {
      const fams = await ensurePlatformFamiliesCache();
      if (familySel) {
        familySel.innerHTML = "";
        for (const f of fams) {
          const o = document.createElement("option");
          o.value = String(f.id);
          o.textContent = `${f.name} (#${f.id})`;
          familySel.appendChild(o);
        }
      }
      setInviteModalOpen(true);
    };

    if (openBtn && openBtn.dataset.bwWired !== "1") {
      openBtn.dataset.bwWired = "1";
      openBtn.addEventListener("click", () =>
        open().catch((e) => setCallout(document.getElementById("adminCallout"), e.message, "error"))
      );
    }
    if (cancel && cancel.dataset.bwWired !== "1") {
      cancel.dataset.bwWired = "1";
      cancel.addEventListener("click", () => setInviteModalOpen(false));
    }
    if (backdrop && backdrop.dataset.bwWired !== "1") {
      backdrop.dataset.bwWired = "1";
      backdrop.addEventListener("click", () => setInviteModalOpen(false));
    }
    if (form && form.dataset.bwWired !== "1") {
      form.dataset.bwWired = "1";
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const email = (document.getElementById("adminInviteEmail") || {}).value || "";
        const familyId = parseInt((document.getElementById("adminInviteFamily") || {}).value || "", 10);
        const familyRole = (document.getElementById("adminInviteFamilyRole") || {}).value || "view";
        const callout = document.getElementById("adminCallout");
        try {
          setCallout(callout, "Adding…", "pending");
          await api("/api/platform/users/invite", "POST", {
            email: String(email).trim(),
            family_id: familyId,
            family_role: familyRole,
          });
          setCallout(callout, "User added to family.", "ok");
          setInviteModalOpen(false);
          form.reset();
          await loadUsers();
        } catch (e) {
          setCallout(callout, (e && e.message) || String(e), "error");
        }
      });
    }
  }

  async function loadUsers() {
    wirePlatformUsersFilters();
    wireUserDrawerChrome();
    wireInviteModal();
    const users = await api("/api/platform/users", "GET");
    cachedPlatformUsers = Array.isArray(users) ? users : [];
    await ensurePlatformFamiliesCache();
    populateUsersFamilyFilter();
    renderPlatformUsersTable();
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

  boot();
})();
