/* eslint-disable no-undef */
/*
 * BalanceWhiz in-app feedback module.
 *
 * Provides three lightweight surfaces, all loaded on authenticated SPA pages
 * (calendar / transactions / reports / settings):
 *
 *   1. Floating "Feedback" button (bottom-right) that opens a bug-report modal
 *      capturing what the user was trying to do, what happened, an optional
 *      screenshot (clipboard paste / drag-drop / file picker), and metadata
 *      about the current view.
 *
 *   2. `BW.feedback.attachReactions(container, { contextKey, label })`
 *      renders a small thumbs-up / thumbs-down row. Thumbs-down expands a
 *      "what was confusing?" textarea before submission.
 *
 *   3. Beta pulse prompts triggered by `bw:milestone` CustomEvents dispatched
 *      from app.js after key moments (first login, first reconciliation,
 *      first recurring transaction, first report visit). Dismiss state is
 *      kept in localStorage; the user is never prompted twice for the same
 *      milestone on the same device.
 *
 * The module reuses the global `api()` helper, `state`, and `showBwToast()`
 * exposed by app.js, so include this file AFTER app.js on each page.
 */

(function () {
  "use strict";

  if (window.BW_FEEDBACK_LOADED) return;
  window.BW_FEEDBACK_LOADED = true;

  const PULSE_STORAGE_PREFIX = "bw:pulse:";
  const PULSE_DEFINITIONS = {
    "first-login": {
      title: "Welcome to BalanceWhiz",
      body: "How clear is the forecast so far? Anything confusing yet?",
      promptId: "first_login",
    },
    "first-reconcile": {
      title: "First reconciliation — nice",
      body: "Was confirming your balance against the forecast straightforward?",
      promptId: "first_reconcile",
    },
    "first-recurring": {
      title: "Recurring transaction saved",
      body: "Did the recurring setup match what you were trying to do?",
      promptId: "first_recurring",
    },
    "first-report-visit": {
      title: "First report visit",
      body: "Anything missing from this view, or unclear?",
      promptId: "first_report_visit",
    },
  };

  function safeApi(path, method, body) {
    if (typeof window.api === "function") {
      return window.api(path, method, body);
    }
    // Fallback: use fetch directly. This is only used if app.js failed to
    // expose its helper (defensive — should not happen in normal pages).
    const headers = { "Content-Type": "application/json" };
    try {
      const t = sessionStorage.getItem("bw_api_access_token");
      if (t) headers.Authorization = `Bearer ${t}`;
    } catch (_) {}
    const apiBase = (window.API_BASE && window.API_BASE !== "__API_BASE__" ? window.API_BASE : "").replace(/\/$/, "");
    return fetch(`${apiBase}${path}`, {
      method: method || "GET",
      headers,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => {
      if (!r.ok) {
        let detail = `HTTP ${r.status}`;
        try {
          const j = await r.json();
          if (j && j.detail) detail = String(j.detail);
        } catch (_) {}
        throw new Error(detail);
      }
      const ct = r.headers.get("content-type") || "";
      return ct.includes("json") ? r.json() : r.text();
    });
  }

  function toast(message, opts) {
    if (typeof window.showBwToast === "function") {
      window.showBwToast(message, opts || {});
    }
  }

  function currentContext() {
    const body = document.body;
    const view = (body && body.dataset && body.dataset.bwView) || null;
    let forecastMonth = null;
    const monthEl = document.getElementById("monthInput") || document.getElementById("calendarMonth");
    if (monthEl && monthEl.value) forecastMonth = String(monthEl.value).trim() || null;
    const familyId =
      window.state && window.state.activeFamilyId ? Number(window.state.activeFamilyId) || null : null;
    return {
      route: location.pathname + location.search,
      view,
      forecast_month: forecastMonth,
      family_id: familyId,
      browser_ua: navigator.userAgent.slice(0, 480),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    };
  }

  // ---------------------------------------------------------------------
  // Floating button + bug modal
  // ---------------------------------------------------------------------

  let modalEl = null;
  let modalScreenshotDataUrl = null;

  function ensureFloatingButton() {
    if (document.getElementById("bwFeedbackBtn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "bwFeedbackBtn";
    btn.className = "bw-fb-launcher";
    btn.setAttribute("aria-label", "Send feedback");
    btn.innerHTML = `
      <span class="bw-fb-launcher__icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      </span>
      <span class="bw-fb-launcher__label">Feedback</span>
    `;
    btn.addEventListener("click", openBugModal);
    document.body.appendChild(btn);
  }

  function ensureBugModal() {
    if (modalEl) return modalEl;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay bw-fb-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="modal bw-fb-modal" role="dialog" aria-modal="true" aria-labelledby="bwFbTitle">
        <header class="bw-fb-modal__head">
          <div>
            <p class="bw-fb-modal__eyebrow">Feedback</p>
            <h2 id="bwFbTitle" class="bw-fb-modal__title">Help us make BalanceWhiz better</h2>
            <p class="bw-fb-modal__subtitle">Tell us what you were trying to do and what happened — screenshots welcome.</p>
          </div>
          <button type="button" class="bw-fb-modal__close" aria-label="Close" data-bw-fb-close>&times;</button>
        </header>

        <form class="bw-fb-form" data-bw-fb-form>
          <div class="bw-fb-form__row">
            <label class="bw-fb-form__label" for="bwFbTrying">What were you trying to do?</label>
            <textarea id="bwFbTrying" class="bw-fb-form__textarea" rows="3" placeholder="Example: I was trying to mark today's balance as reconciled"></textarea>
          </div>
          <div class="bw-fb-form__row">
            <label class="bw-fb-form__label" for="bwFbHappened">What happened?</label>
            <textarea id="bwFbHappened" class="bw-fb-form__textarea" rows="4" placeholder="Example: After clicking Save, the modal didn't close and nothing seemed to happen"></textarea>
          </div>
          <div class="bw-fb-form__row">
            <label class="bw-fb-form__label" for="bwFbEmail">
              Reply email <span class="bw-fb-form__hint">(optional)</span>
            </label>
            <input id="bwFbEmail" class="bw-fb-form__input" type="email" autocomplete="email" placeholder="you@example.com" />
          </div>

          <div class="bw-fb-form__row">
            <p class="bw-fb-form__label">Screenshot <span class="bw-fb-form__hint">(optional)</span></p>
            <div class="bw-fb-drop" data-bw-fb-drop tabindex="0" aria-label="Drop or paste a screenshot here">
              <div class="bw-fb-drop__empty" data-bw-fb-empty>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="m21 17-4-4-4 4-3-3-4 4"/></svg>
                <p class="bw-fb-drop__title">Drop, paste, or upload</p>
                <p class="bw-fb-drop__hint">PNG or JPG, up to ~500 KB</p>
                <button type="button" class="bw-fb-drop__btn" data-bw-fb-pick>Choose file</button>
                <input class="bw-fb-drop__file" type="file" accept="image/*" data-bw-fb-file hidden />
              </div>
              <div class="bw-fb-drop__preview" data-bw-fb-preview hidden>
                <img class="bw-fb-drop__img" alt="Screenshot preview" data-bw-fb-img />
                <button type="button" class="bw-fb-drop__remove" data-bw-fb-remove>Remove</button>
              </div>
            </div>
          </div>

          <p class="bw-fb-context" data-bw-fb-context aria-label="Capturing context"></p>
          <p class="bw-fb-error" data-bw-fb-error hidden role="alert"></p>

          <div class="bw-fb-form__actions">
            <button type="button" class="bw-fb-form__cancel" data-bw-fb-close>Cancel</button>
            <button type="submit" class="bw-fb-form__submit" data-bw-fb-submit>Send feedback</button>
          </div>
        </form>
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeBugModal();
    });
    overlay.querySelectorAll("[data-bw-fb-close]").forEach((b) =>
      b.addEventListener("click", () => closeBugModal())
    );

    const fileInput = overlay.querySelector("[data-bw-fb-file]");
    const pickBtn = overlay.querySelector("[data-bw-fb-pick]");
    if (pickBtn && fileInput) {
      pickBtn.addEventListener("click", () => fileInput.click());
    }
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) handleScreenshotFile(f);
      });
    }
    const removeBtn = overlay.querySelector("[data-bw-fb-remove]");
    if (removeBtn) removeBtn.addEventListener("click", clearScreenshot);

    const drop = overlay.querySelector("[data-bw-fb-drop]");
    if (drop) {
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop.classList.add("is-dragover");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("is-dragover");
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleScreenshotFile(f);
      });
    }

    overlay.querySelector("[data-bw-fb-form]").addEventListener("submit", submitBugForm);

    document.body.appendChild(overlay);
    modalEl = overlay;
    return overlay;
  }

  function handleScreenshotFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      flashError("Please choose an image file (PNG or JPG).");
      return;
    }
    // Soft cap before encoding (raw bytes); base64 grows ~33%.
    if (file.size > 520 * 1024) {
      flashError("That image is over ~500 KB. Try a smaller crop.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      modalScreenshotDataUrl = String(reader.result || "");
      const preview = modalEl.querySelector("[data-bw-fb-preview]");
      const empty = modalEl.querySelector("[data-bw-fb-empty]");
      const img = modalEl.querySelector("[data-bw-fb-img]");
      if (img) img.src = modalScreenshotDataUrl;
      if (preview) preview.hidden = false;
      if (empty) empty.hidden = true;
    };
    reader.readAsDataURL(file);
  }

  function clearScreenshot() {
    modalScreenshotDataUrl = null;
    if (!modalEl) return;
    const preview = modalEl.querySelector("[data-bw-fb-preview]");
    const empty = modalEl.querySelector("[data-bw-fb-empty]");
    const img = modalEl.querySelector("[data-bw-fb-img]");
    const fileInput = modalEl.querySelector("[data-bw-fb-file]");
    if (preview) preview.hidden = true;
    if (empty) empty.hidden = false;
    if (img) img.src = "";
    if (fileInput) fileInput.value = "";
  }

  function flashError(msg) {
    if (!modalEl) return;
    const el = modalEl.querySelector("[data-bw-fb-error]");
    if (!el) return;
    el.textContent = msg;
    el.hidden = !msg;
  }

  function pasteListener(ev) {
    if (!modalEl || !modalEl.classList.contains("is-open")) return;
    const items = ev.clipboardData && ev.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && /^image\//.test(item.type)) {
        const blob = item.getAsFile();
        if (blob) {
          handleScreenshotFile(blob);
          ev.preventDefault();
          return;
        }
      }
    }
  }

  function openBugModal() {
    ensureBugModal();
    clearScreenshot();
    flashError("");
    const trying = modalEl.querySelector("#bwFbTrying");
    const happened = modalEl.querySelector("#bwFbHappened");
    const email = modalEl.querySelector("#bwFbEmail");
    if (trying) trying.value = "";
    if (happened) happened.value = "";
    if (email && window.state && window.state.user && window.state.user.email) {
      email.value = String(window.state.user.email);
    } else if (email) {
      email.value = "";
    }

    // Show captured context so testers know what's being attached.
    const ctx = currentContext();
    const ctxEl = modalEl.querySelector("[data-bw-fb-context]");
    if (ctxEl) {
      const bits = [
        ctx.view ? `view: ${ctx.view}` : null,
        ctx.forecast_month ? `month: ${ctx.forecast_month}` : null,
        ctx.viewport ? `viewport: ${ctx.viewport}` : null,
      ].filter(Boolean);
      ctxEl.textContent = bits.length
        ? `We'll also attach: ${bits.join(" · ")}`
        : "We'll attach a little context about this page.";
    }

    modalEl.classList.add("modal-overlay--open");
    modalEl.classList.add("is-open");
    modalEl.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", escListener);
    document.addEventListener("paste", pasteListener);
    setTimeout(() => trying && trying.focus(), 40);
  }

  function closeBugModal() {
    if (!modalEl) return;
    modalEl.classList.remove("modal-overlay--open");
    modalEl.classList.remove("is-open");
    modalEl.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", escListener);
    document.removeEventListener("paste", pasteListener);
  }

  function escListener(e) {
    if (e.key === "Escape") closeBugModal();
  }

  async function submitBugForm(ev) {
    ev.preventDefault();
    flashError("");
    if (!modalEl) return;
    const trying = (modalEl.querySelector("#bwFbTrying").value || "").trim();
    const happened = (modalEl.querySelector("#bwFbHappened").value || "").trim();
    const email = (modalEl.querySelector("#bwFbEmail").value || "").trim();
    if (!trying && !happened) {
      flashError("Tell us what you were trying to do or what happened.");
      return;
    }
    const submitBtn = modalEl.querySelector("[data-bw-fb-submit]");
    const orig = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
    }
    try {
      await safeApi("/api/feedback", "POST", {
        kind: "bug",
        what_trying: trying || null,
        what_happened: happened || null,
        contact_email: email || null,
        screenshot: modalScreenshotDataUrl || null,
        ...currentContext(),
      });
      closeBugModal();
      toast("Thanks — your feedback was sent.", { durationMs: 3200 });
    } catch (err) {
      const msg = (err && err.message) || "Could not send feedback. Please try again.";
      flashError(msg.length > 200 ? "Could not send feedback. Please try again." : msg);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = orig || "Send feedback";
      }
    }
  }

  // ---------------------------------------------------------------------
  // Quick reactions
  // ---------------------------------------------------------------------

  function attachReactions(container, opts) {
    if (!container || !opts || !opts.contextKey) return null;
    if (container.querySelector(":scope > .bw-fb-reactions")) return null;

    const wrap = document.createElement("div");
    wrap.className = "bw-fb-reactions";
    wrap.dataset.contextKey = String(opts.contextKey);
    wrap.innerHTML = `
      <span class="bw-fb-reactions__label">${opts.label || "Was this useful?"}</span>
      <div class="bw-fb-reactions__btns" role="group" aria-label="Reaction">
        <button type="button" class="bw-fb-reactions__btn" data-rating="up" aria-label="Yes">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.5a2 2 0 0 1 2 2.31l-1.4 8a2 2 0 0 1-2 1.69H7"/><path d="M3 10h4v12H3z"/></svg>
        </button>
        <button type="button" class="bw-fb-reactions__btn" data-rating="down" aria-label="No">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.5a2 2 0 0 1-2-2.31l1.4-8a2 2 0 0 1 2-1.69H17"/><path d="M21 14h-4V2h4z"/></svg>
        </button>
      </div>
      <div class="bw-fb-reactions__follow" hidden>
        <textarea class="bw-fb-reactions__text" rows="2" placeholder="What was confusing or missing?"></textarea>
        <div class="bw-fb-reactions__follow-actions">
          <button type="button" class="bw-fb-reactions__send">Send</button>
        </div>
      </div>
      <span class="bw-fb-reactions__thanks" hidden>Thanks for the signal.</span>
    `;
    container.appendChild(wrap);

    const upBtn = wrap.querySelector('[data-rating="up"]');
    const downBtn = wrap.querySelector('[data-rating="down"]');
    const followBox = wrap.querySelector(".bw-fb-reactions__follow");
    const textEl = wrap.querySelector(".bw-fb-reactions__text");
    const sendBtn = wrap.querySelector(".bw-fb-reactions__send");
    const thanks = wrap.querySelector(".bw-fb-reactions__thanks");

    let chosen = null;

    function lockUI() {
      upBtn.disabled = true;
      downBtn.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      if (textEl) textEl.disabled = true;
    }

    function finish() {
      lockUI();
      followBox.hidden = true;
      thanks.hidden = false;
    }

    async function send(rating, comment) {
      try {
        await safeApi("/api/feedback", "POST", {
          kind: "reaction",
          rating,
          comment: comment || null,
          context_key: String(opts.contextKey),
          ...currentContext(),
        });
        finish();
      } catch (_) {
        toast("Couldn't record that reaction.", { durationMs: 2600 });
      }
    }

    upBtn.addEventListener("click", () => {
      if (chosen) return;
      chosen = "up";
      upBtn.classList.add("is-active");
      send("up", null);
    });
    downBtn.addEventListener("click", () => {
      if (chosen) return;
      chosen = "down";
      downBtn.classList.add("is-active");
      followBox.hidden = false;
      if (textEl) setTimeout(() => textEl.focus(), 40);
    });
    sendBtn.addEventListener("click", () => {
      const txt = (textEl && textEl.value ? textEl.value : "").trim();
      send("down", txt || null);
    });

    return wrap;
  }

  // Attach reactions to every report card visible after the reports view
  // renders. We do this on demand from app.js (or via a soft observer here)
  // so consumers don't need to wire each one. The contextKey is derived
  // from the card's data-report-id or its first heading.
  function autoAttachReportReactions(root) {
    if (!root) return;
    const cards = root.querySelectorAll(".card[data-report-id], section.card[id^='report']");
    cards.forEach((card) => {
      if (card.dataset.bwFbReactions) return;
      card.dataset.bwFbReactions = "1";
      const id = card.dataset.reportId || card.id || "report";
      attachReactions(card, { contextKey: `report:${id}` });
    });
  }

  // ---------------------------------------------------------------------
  // Beta pulse prompts
  // ---------------------------------------------------------------------

  let pulseEl = null;
  let pulseCurrentId = null;
  let pulseAutoCloseTimer = null;

  function pulseSeen(id) {
    try {
      return !!localStorage.getItem(PULSE_STORAGE_PREFIX + id);
    } catch (_) {
      return false;
    }
  }

  function markPulseSeen(id) {
    try {
      localStorage.setItem(PULSE_STORAGE_PREFIX + id, String(Date.now()));
    } catch (_) {}
  }

  function ensurePulseEl() {
    if (pulseEl) return pulseEl;
    const card = document.createElement("aside");
    card.className = "bw-fb-pulse";
    card.setAttribute("aria-live", "polite");
    card.hidden = true;
    card.innerHTML = `
      <div class="bw-fb-pulse__head">
        <div>
          <p class="bw-fb-pulse__eyebrow">Quick check</p>
          <p class="bw-fb-pulse__title" data-bw-pulse-title></p>
        </div>
        <button type="button" class="bw-fb-pulse__close" aria-label="Dismiss" data-bw-pulse-dismiss>&times;</button>
      </div>
      <p class="bw-fb-pulse__body" data-bw-pulse-body></p>
      <div class="bw-fb-pulse__rate" role="group" aria-label="Rate this">
        <button type="button" class="bw-fb-pulse__rate-btn" data-rating="clear">Clear</button>
        <button type="button" class="bw-fb-pulse__rate-btn" data-rating="mixed">Mixed</button>
        <button type="button" class="bw-fb-pulse__rate-btn" data-rating="confusing">Confusing</button>
      </div>
      <textarea class="bw-fb-pulse__text" rows="2" placeholder="Anything you'd want us to change? (optional)"></textarea>
      <div class="bw-fb-pulse__actions">
        <button type="button" class="bw-fb-pulse__never" data-bw-pulse-never>Don't show again</button>
        <button type="button" class="bw-fb-pulse__send" data-bw-pulse-send>Send</button>
      </div>
    `;
    document.body.appendChild(card);

    card.querySelectorAll(".bw-fb-pulse__rate-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        card.querySelectorAll(".bw-fb-pulse__rate-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    });
    card.querySelector("[data-bw-pulse-dismiss]").addEventListener("click", () => closePulse(false));
    card.querySelector("[data-bw-pulse-never]").addEventListener("click", () => {
      if (pulseCurrentId) markPulseSeen(pulseCurrentId);
      closePulse(false);
    });
    card.querySelector("[data-bw-pulse-send]").addEventListener("click", async () => {
      if (!pulseCurrentId) return;
      const def = PULSE_DEFINITIONS[pulseCurrentId];
      if (!def) return;
      const ratedBtn = card.querySelector(".bw-fb-pulse__rate-btn.is-active");
      const rating = ratedBtn ? ratedBtn.dataset.rating : null;
      const comment = (card.querySelector(".bw-fb-pulse__text").value || "").trim();
      if (!rating && !comment) {
        // nothing to send; treat as dismiss
        closePulse(false);
        return;
      }
      try {
        await safeApi("/api/feedback", "POST", {
          kind: "pulse",
          prompt_id: def.promptId,
          rating: rating || null,
          comment: comment || null,
          ...currentContext(),
        });
        markPulseSeen(pulseCurrentId);
        toast("Thanks — appreciate the input.", { durationMs: 2600 });
        closePulse(true);
      } catch (_) {
        toast("Couldn't send that just now.", { durationMs: 2600 });
      }
    });

    pulseEl = card;
    return card;
  }

  function showPulse(id) {
    if (!id || !PULSE_DEFINITIONS[id]) return;
    if (pulseSeen(id)) return;
    // Don't compete with the bug modal.
    if (modalEl && modalEl.classList.contains("is-open")) return;
    ensurePulseEl();
    pulseCurrentId = id;
    const def = PULSE_DEFINITIONS[id];
    pulseEl.querySelector("[data-bw-pulse-title]").textContent = def.title;
    pulseEl.querySelector("[data-bw-pulse-body]").textContent = def.body;
    pulseEl.querySelectorAll(".bw-fb-pulse__rate-btn").forEach((b) => b.classList.remove("is-active"));
    pulseEl.querySelector(".bw-fb-pulse__text").value = "";
    pulseEl.hidden = false;
    requestAnimationFrame(() => pulseEl.classList.add("is-visible"));
    if (pulseAutoCloseTimer) clearTimeout(pulseAutoCloseTimer);
    // Auto-collapse (not "seen") after 90s of inactivity — don't burn the prompt.
    pulseAutoCloseTimer = setTimeout(() => closePulse(false), 90_000);
  }

  function closePulse(seen) {
    if (!pulseEl) return;
    if (seen && pulseCurrentId) markPulseSeen(pulseCurrentId);
    pulseEl.classList.remove("is-visible");
    setTimeout(() => {
      if (pulseEl) pulseEl.hidden = true;
    }, 220);
    pulseCurrentId = null;
    if (pulseAutoCloseTimer) {
      clearTimeout(pulseAutoCloseTimer);
      pulseAutoCloseTimer = null;
    }
  }

  function onMilestone(e) {
    const id = e && e.detail && e.detail.id;
    if (!id) return;
    // Slight delay so the user finishes the action that triggered the milestone
    // before being interrupted with a pulse prompt.
    setTimeout(() => showPulse(id), 700);
  }

  // ---------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------

  function init() {
    ensureFloatingButton();
    document.addEventListener("bw:milestone", onMilestone);
    // For pages that render report cards, attach reactions opportunistically.
    if (document.body && document.body.dataset.bwView === "reports") {
      // Try a few times to catch async card renders.
      let tries = 0;
      const id = setInterval(() => {
        autoAttachReportReactions(document.body);
        tries += 1;
        if (tries > 6) clearInterval(id);
      }, 1200);
    }
  }

  // Public API surface
  window.BW = window.BW || {};
  window.BW.feedback = {
    open: openBugModal,
    attachReactions,
    showPulse,
    markPulseSeen,
    autoAttachReportReactions,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
