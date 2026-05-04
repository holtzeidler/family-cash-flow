(function () {
  function getApiBase() {
    const b = window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "";
    return b.replace(/\/$/, "");
  }

  async function request(path, method, body) {
    const apiBase = getApiBase();
    const fullPath = `${apiBase}${path}`;
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
    return { ok: res.ok, status: res.status, data };
  }

  function setCallout(el, msg, mode) {
    if (!el) return;
    el.textContent = msg || "";
    el.className = mode ? `callout callout--${mode}` : "callout";
    el.style.display = msg ? "block" : "none";
  }

  function getTokenFromQuery() {
    try {
      const t = new URLSearchParams(window.location.search).get("token");
      return t && String(t).trim() ? String(t).trim() : "";
    } catch (_) {
      return "";
    }
  }

  const callout = document.getElementById("inviteCallout");
  const bodyEl = document.getElementById("inviteBody");
  const summary = document.getElementById("inviteSummary");
  const acceptBtn = document.getElementById("inviteAcceptBtn");
  const loginLink = document.getElementById("inviteLoginLink");
  const signupLink = document.getElementById("inviteSignupLink");
  const homeBtn = document.getElementById("inviteHomeBtn");

  let token = getTokenFromQuery();

  if (homeBtn) {
    homeBtn.addEventListener("click", () => {
      window.location.href = "../";
    });
  }

  async function boot() {
    if (!token) {
      setCallout(callout, "Missing invitation link. Ask the family owner to resend your invite.", "error");
      return;
    }
    try {
      sessionStorage.setItem("bw_invite_token", token);
    } catch (_) {}
    const enc = encodeURIComponent(token);
    const r = await request(`/api/public/invites/by-token/${enc}`, "GET");
    if (!r.ok || !r.data || !r.data.ok) {
      setCallout(callout, "This invitation is not valid or has expired.", "error");
      return;
    }
    const d = r.data;
    const accessLabel = String(d.access_mode || "").toLowerCase() === "view" ? "view only" : "full edit";
    summary.textContent = `You are invited to join "${d.family_name}" as ${accessLabel}. This invitation was sent to ${d.invitee_email}. Sign in or create an account with that same email, then click Accept below.`;
    bodyEl.hidden = false;
    if (loginLink) loginLink.href = `../login.html?invite=${enc}`;
    if (signupLink) signupLink.href = `../signup/?invite=${enc}`;
    setCallout(callout, "", "");
    const me = await request("/api/auth/me", "GET");
    if (me.ok && me.data && me.data.user && me.data.user.email) {
      const cur = String(me.data.user.email).trim().toLowerCase();
      const invE = String(d.invitee_email || "").trim().toLowerCase();
      if (cur && invE && cur !== invE) {
        setCallout(
          callout,
          `You are signed in as ${me.data.user.email}, but this invitation is for ${d.invitee_email}. Log out and sign in with the invited address, then accept — or ask the family owner to send a new invite to ${me.data.user.email}.`,
          "error"
        );
      }
    }
  }

  if (acceptBtn) {
    acceptBtn.addEventListener("click", async () => {
      if (!token) return;
      setCallout(callout, "Accepting…", "pending");
      acceptBtn.disabled = true;
      const r = await request("/api/invites/accept", "POST", { token });
      acceptBtn.disabled = false;
      if (r.status === 401) {
        setCallout(callout, "Please log in or create an account with the invited email, then try Accept again.", "error");
        return;
      }
      if (!r.ok) {
        const detail = r.data && r.data.detail ? String(r.data.detail) : `Request failed (${r.status})`;
        setCallout(callout, detail, "error");
        return;
      }
      try {
        sessionStorage.removeItem("bw_invite_token");
      } catch (_) {}
      setCallout(callout, "You have joined the family. Opening the app…", "ok");
      setTimeout(() => {
        window.location.href = "../";
      }, 600);
    });
  }

  void boot();
})();
