/**
 * BalanceWhiz first-run tour.
 *
 * A lightweight 3-step spotlight tour shown to a user after they finish account
 * setup. The goal is to surface the three most important calendar interactions
 * (adding items, setting a safe balance, reconciling reality) without throwing
 * a wall of marketing copy at them.
 *
 * Entry points:
 *   - window.BW.tour.start()        Begin the tour now (called from the
 *                                   "Start quick tour" CTA of the forecast-
 *                                   ready modal, or from Settings/Help).
 *   - window.BW.tour.reset()        Clear the localStorage "seen" flag.
 *   - window.BW.tour.hasSeen()      Returns true if the user has already
 *                                   completed or explicitly skipped the tour.
 *   - window.BW.tour.markSkipped()  Mark the tour as skipped (used by the
 *                                   intro modal's "Skip for now" CTA).
 *
 * Visual approach (per design direction):
 *   - A very light backdrop (~18% opacity) instead of heavy darkening.
 *   - Target gets a soft accent-green outline ring; never moves or scales.
 *   - White tooltip card with title, body, optional helper text, and a single
 *     forward CTA. Step counter ("1 of 3") is included for orientation.
 *   - Smooth fade transitions between steps; no big animations.
 */
(function () {
  "use strict";

  const TOUR_SEEN_KEY = "bw_tour_seen_v1";
  const ZINDEX_BACKDROP = 9990;
  const ZINDEX_HIGHLIGHT = 9991;
  const ZINDEX_TOOLTIP = 9993;

  let backdropEl = null;
  let tooltipEl = null;
  let currentTargetEl = null;
  let currentStepIdx = -1;
  let resizeHandler = null;
  let scrollHandler = null;
  let onAfterStepEnd = null;

  /**
   * Steps are intentionally short. Each `findTarget()` returns either an
   * existing DOM element (preferred) or null. When null, the step is skipped
   * gracefully and the tour advances.
   */
  const STEPS = [
    {
      id: "calendar-date",
      findTarget: findFutureCalendarCellTarget,
      title: "Add income and expenses directly to your forecast",
      body:
        "Click any calendar date to add bills, paychecks, transfers, or one-time expenses. You can start simple and refine later.",
      ctaLabel: "Next",
      placement: "auto",
    },
    {
      id: "safe-balance",
      findTarget: () => document.getElementById("navSettingsView"),
      title: "Define your safe balance",
      body:
        "Set a minimum checking balance in Settings so BalanceWhiz can warn you before cash gets tight.",
      helper: "Example: Keep at least $1,000 in checking.",
      ctaLabel: "Next",
      placement: "below",
    },
    {
      id: "reconcile",
      findTarget: () => document.getElementById("sidebarPendingTxCard"),
      title: "Keep your forecast accurate",
      body:
        "As transactions clear your account, mark them confirmed so your forecast reflects reality instead of estimates.",
      ctaLabel: "Got it",
      placement: "auto",
    },
  ];

  // ---------------------------------------------------------------------
  // Target discovery
  // ---------------------------------------------------------------------

  /**
   * Pick a future calendar cell to anchor Step 1 on. Preference order:
   *   1. The cell flagged `.is-today`'s parent cell (i.e. today's cell).
   *   2. The first `.cal-cell[data-iso]` whose ISO date is strictly in the future.
   *   3. The first `.cal-cell[data-iso]` that's in the current month at all
   *      (regardless of past/future), so we always have *something* to point at.
   * Returns null if the grid hasn't rendered any cells yet (caller will retry).
   */
  function findFutureCalendarCellTarget() {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const todayCell = document.querySelector(".cal-cell .cal-daynum-num.is-today");
    if (todayCell) {
      const cell = todayCell.closest(".cal-cell");
      if (cell) return cell;
    }

    const cells = document.querySelectorAll(".cal-cell[data-iso]");
    if (!cells.length) return null;

    let firstFuture = null;
    let firstAny = null;
    for (const cell of cells) {
      const iso = cell.getAttribute("data-iso") || "";
      if (!firstAny) firstAny = cell;
      if (iso > todayIso) {
        firstFuture = cell;
        break;
      }
    }
    return firstFuture || firstAny;
  }

  // ---------------------------------------------------------------------
  // Backdrop + tooltip element lifecycle
  // ---------------------------------------------------------------------

  function ensureBackdrop() {
    if (backdropEl) return backdropEl;
    backdropEl = document.createElement("div");
    backdropEl.className = "bw-tour-backdrop";
    backdropEl.setAttribute("aria-hidden", "true");
    backdropEl.style.zIndex = String(ZINDEX_BACKDROP);
    document.body.appendChild(backdropEl);
    return backdropEl;
  }

  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = "bw-tour-tooltip";
    tooltipEl.setAttribute("role", "dialog");
    tooltipEl.setAttribute("aria-modal", "false");
    tooltipEl.setAttribute("aria-labelledby", "bwTourTitle");
    tooltipEl.style.zIndex = String(ZINDEX_TOOLTIP);
    tooltipEl.innerHTML = `
      <div class="bw-tour-tooltip__arrow" data-bw-tour-arrow aria-hidden="true"></div>
      <div class="bw-tour-tooltip__head">
        <span class="bw-tour-tooltip__counter" data-bw-tour-counter>1 of 3</span>
        <button type="button" class="bw-tour-tooltip__close" data-bw-tour-skip aria-label="Skip tour">×</button>
      </div>
      <h3 class="bw-tour-tooltip__title" id="bwTourTitle" data-bw-tour-title></h3>
      <p class="bw-tour-tooltip__body" data-bw-tour-body></p>
      <p class="bw-tour-tooltip__helper" data-bw-tour-helper hidden></p>
      <div class="bw-tour-tooltip__actions">
        <button type="button" class="bw-tour-tooltip__cta" data-bw-tour-next>Next</button>
      </div>
    `;
    document.body.appendChild(tooltipEl);

    tooltipEl.querySelector("[data-bw-tour-skip]").addEventListener("click", () => endTour({ skipped: true }));
    tooltipEl.querySelector("[data-bw-tour-next]").addEventListener("click", advanceStep);
    return tooltipEl;
  }

  function clearTargetHighlight() {
    if (currentTargetEl) {
      currentTargetEl.classList.remove("bw-tour-target");
      // Restore the original inline z-index/position we stamped on.
      const prevZ = currentTargetEl.dataset.bwTourPrevZIndex;
      const prevPos = currentTargetEl.dataset.bwTourPrevPosition;
      if (prevZ === "__unset") currentTargetEl.style.removeProperty("z-index");
      else if (prevZ != null) currentTargetEl.style.zIndex = prevZ;
      if (prevPos === "__unset") currentTargetEl.style.removeProperty("position");
      else if (prevPos != null) currentTargetEl.style.position = prevPos;
      delete currentTargetEl.dataset.bwTourPrevZIndex;
      delete currentTargetEl.dataset.bwTourPrevPosition;
      currentTargetEl = null;
    }
  }

  function applyTargetHighlight(el) {
    clearTargetHighlight();
    if (!el) return;
    currentTargetEl = el;
    // Preserve the inline z-index/position so we can restore them at end of tour.
    const inlineZ = el.style.zIndex;
    const inlinePos = el.style.position;
    el.dataset.bwTourPrevZIndex = inlineZ === "" ? "__unset" : inlineZ;
    el.dataset.bwTourPrevPosition = inlinePos === "" ? "__unset" : inlinePos;

    // Lift the target above the backdrop without disturbing layout. We only
    // set position:relative if the element is statically positioned so the
    // z-index has effect — leave anything already positioned alone.
    const computed = window.getComputedStyle(el);
    if (computed.position === "static") {
      el.style.position = "relative";
    }
    el.style.zIndex = String(ZINDEX_HIGHLIGHT);
    el.classList.add("bw-tour-target");
  }

  // ---------------------------------------------------------------------
  // Tooltip positioning
  // ---------------------------------------------------------------------

  function positionTooltip(targetEl, placement) {
    if (!tooltipEl) return;
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tr = targetEl.getBoundingClientRect();

    // Measure tooltip (must be visible to measure correctly).
    tooltipEl.style.visibility = "hidden";
    tooltipEl.style.display = "block";
    tooltipEl.style.left = "0px";
    tooltipEl.style.top = "0px";
    const tt = tooltipEl.getBoundingClientRect();
    const tw = tt.width;
    const th = tt.height;

    // Decide vertical placement.
    let placeBelow;
    if (placement === "below") placeBelow = true;
    else if (placement === "above") placeBelow = false;
    else {
      // auto: prefer below if there is enough room.
      const spaceBelow = vh - tr.bottom;
      const spaceAbove = tr.top;
      placeBelow = spaceBelow >= th + margin || spaceBelow >= spaceAbove;
    }

    let top = placeBelow ? tr.bottom + margin : tr.top - th - margin;
    // If the chosen side overflows, flip.
    if (placeBelow && top + th > vh - 8) {
      top = Math.max(8, tr.top - th - margin);
      placeBelow = false;
    } else if (!placeBelow && top < 8) {
      top = Math.min(vh - th - 8, tr.bottom + margin);
      placeBelow = true;
    }

    // Horizontal: center over target, clamp to viewport.
    const targetCenterX = tr.left + tr.width / 2;
    let left = targetCenterX - tw / 2;
    left = Math.max(8, Math.min(left, vw - tw - 8));

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
    tooltipEl.style.visibility = "";

    // Arrow placement: above tooltip if tooltip is below target, vice versa.
    const arrow = tooltipEl.querySelector("[data-bw-tour-arrow]");
    if (arrow) {
      arrow.dataset.side = placeBelow ? "top" : "bottom";
      const arrowLeftWithinTooltip = Math.max(16, Math.min(tw - 16, targetCenterX - left));
      arrow.style.left = `${Math.round(arrowLeftWithinTooltip)}px`;
    }
  }

  // ---------------------------------------------------------------------
  // Step rendering
  // ---------------------------------------------------------------------

  function renderStep(stepIdx) {
    if (stepIdx < 0 || stepIdx >= STEPS.length) {
      endTour({ completed: true });
      return;
    }
    const step = STEPS[stepIdx];
    const target = step.findTarget();
    if (!target) {
      // For Step 1 specifically the calendar may still be rendering. Retry
      // a couple of times before giving up and silently advancing.
      if (step.id === "calendar-date" && (step._retries || 0) < 12) {
        step._retries = (step._retries || 0) + 1;
        window.setTimeout(() => renderStep(stepIdx), 250);
        return;
      }
      // No target found — skip to the next step.
      renderStep(stepIdx + 1);
      return;
    }

    // Make sure the target is in view before highlighting.
    try {
      const rect = target.getBoundingClientRect();
      const margin = 60;
      if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (_) {}

    ensureBackdrop();
    ensureTooltip();
    backdropEl.classList.add("bw-tour-backdrop--open");
    tooltipEl.classList.add("bw-tour-tooltip--open");

    tooltipEl.querySelector("[data-bw-tour-counter]").textContent = `${stepIdx + 1} of ${STEPS.length}`;
    tooltipEl.querySelector("[data-bw-tour-title]").textContent = step.title;
    tooltipEl.querySelector("[data-bw-tour-body]").textContent = step.body;
    const helperEl = tooltipEl.querySelector("[data-bw-tour-helper]");
    if (helperEl) {
      if (step.helper) {
        helperEl.textContent = step.helper;
        helperEl.hidden = false;
      } else {
        helperEl.textContent = "";
        helperEl.hidden = true;
      }
    }
    tooltipEl.querySelector("[data-bw-tour-next]").textContent = step.ctaLabel || "Next";

    applyTargetHighlight(target);
    // Position after a frame so layout (incl. scrollIntoView) settles.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentTargetEl) positionTooltip(currentTargetEl, step.placement || "auto");
      });
    });

    // Reposition on resize/scroll so the spotlight stays accurate.
    if (!resizeHandler) {
      resizeHandler = () => {
        if (currentTargetEl) positionTooltip(currentTargetEl, STEPS[currentStepIdx]?.placement || "auto");
      };
      window.addEventListener("resize", resizeHandler);
    }
    if (!scrollHandler) {
      scrollHandler = () => {
        if (currentTargetEl) positionTooltip(currentTargetEl, STEPS[currentStepIdx]?.placement || "auto");
      };
      window.addEventListener("scroll", scrollHandler, true);
    }
  }

  function advanceStep() {
    currentStepIdx += 1;
    if (currentStepIdx >= STEPS.length) {
      endTour({ completed: true });
      return;
    }
    renderStep(currentStepIdx);
  }

  function startTour() {
    // Reset per-tour transient state so a restart from Settings/Help works.
    for (const step of STEPS) delete step._retries;
    currentStepIdx = 0;
    renderStep(currentStepIdx);
  }

  function endTour(opts) {
    clearTargetHighlight();
    if (backdropEl) backdropEl.classList.remove("bw-tour-backdrop--open");
    if (tooltipEl) tooltipEl.classList.remove("bw-tour-tooltip--open");
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    if (scrollHandler) {
      window.removeEventListener("scroll", scrollHandler, true);
      scrollHandler = null;
    }
    currentStepIdx = -1;
    // Mark as seen for both skip and completion — we don't want to nag users
    // who decided either way. Settings → "Show me around" lets them replay it.
    if (opts && (opts.completed || opts.skipped)) markSeen();
    if (typeof onAfterStepEnd === "function") {
      const fn = onAfterStepEnd;
      onAfterStepEnd = null;
      try { fn(); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  function markSeen() {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, String(Date.now()));
    } catch (_) {}
  }

  function hasSeen() {
    try {
      return !!localStorage.getItem(TOUR_SEEN_KEY);
    } catch (_) {
      return false;
    }
  }

  function reset() {
    try {
      localStorage.removeItem(TOUR_SEEN_KEY);
    } catch (_) {}
  }

  function markSkipped() {
    markSeen();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  window.BW = window.BW || {};
  window.BW.tour = {
    start: startTour,
    end: () => endTour({ skipped: true }),
    reset,
    hasSeen,
    markSkipped,
  };

  // ---------------------------------------------------------------------
  // Bootstrap: restart links + auto-start from ?tour=1
  // ---------------------------------------------------------------------

  /**
   * Determine whether the current page hosts the calendar DOM the tour
   * needs to highlight. Other pages (Settings, Reports, public Help)
   * can't run the tour locally — they should hop to /calendar/?tour=1.
   */
  function pageCanRunTour() {
    return !!document.getElementById("calendarGrid")
      || !!document.querySelector(".cal-cell")
      || !!document.getElementById("sidebarPendingTxCard");
  }

  function navigateToCalendarWithTour() {
    try {
      const target = "/calendar/?tour=1";
      // If we're already on /calendar, just start the tour in place.
      if (pageCanRunTour() && location.pathname.replace(/\/+$/, "") === "/calendar") {
        startTour();
        return;
      }
      location.href = target;
    } catch (_) {
      try { startTour(); } catch (__) {}
    }
  }

  function wireRestartButtons() {
    const nodes = document.querySelectorAll("[data-bw-tour-restart]");
    nodes.forEach((el) => {
      if (el.dataset.bwTourRestartBound === "1") return;
      el.dataset.bwTourRestartBound = "1";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        navigateToCalendarWithTour();
      });
    });
  }

  /**
   * If the URL contains ?tour=1 and we're on a page that can host the
   * tour, start it once the relevant DOM appears. Strips the query so a
   * refresh doesn't keep re-triggering.
   */
  function maybeAutoStartFromQuery() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tour") !== "1") return;
      url.searchParams.delete("tour");
      const cleaned = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
      window.history.replaceState({}, "", cleaned);
    } catch (_) {
      return;
    }
    if (!pageCanRunTour()) return;
    // Wait until the grid renders at least one cell, then start.
    let attempts = 0;
    const tryStart = () => {
      attempts += 1;
      const hasCells = document.querySelectorAll(".cal-cell").length > 0;
      if (hasCells || attempts > 40) {
        startTour();
        return;
      }
      window.setTimeout(tryStart, 200);
    };
    window.setTimeout(tryStart, 250);
  }

  function bootstrap() {
    wireRestartButtons();
    maybeAutoStartFromQuery();
    // Re-wire in case restart buttons are added later via dynamic UI.
    document.addEventListener("click", (e) => {
      const target = e.target && e.target.closest && e.target.closest("[data-bw-tour-restart]");
      if (target && target.dataset.bwTourRestartBound !== "1") {
        target.dataset.bwTourRestartBound = "1";
        e.preventDefault();
        navigateToCalendarWithTour();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
