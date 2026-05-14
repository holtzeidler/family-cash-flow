/**
 * BalanceWhiz first-run tour.
 *
 * A lightweight 4-step spotlight tour shown to a user after they finish account
 * setup. The goal is to teach the BalanceWhiz mental model quickly:
 * where to add items, how the minimum balance works, how to keep the forecast
 * accurate, and why variable bills need occasional attention.
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
 *   - White tooltip card with title, short body copy, optional helper text,
 *     and a single forward CTA. Step counter provides orientation.
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
  let currentTargetExtraClass = null;
  let currentDimEl = null;
  let currentSupportEls = [];
  let currentStepIdx = -1;
  let resizeHandler = null;
  let scrollHandler = null;
  let onAfterStepEnd = null;

  /**
   * Steps are intentionally short. Each `findTarget()` returns either an
   * existing DOM element (preferred) or null. When null, the step is skipped
   * gracefully and the tour advances.
   */
  /**
   * Tour progression: Input → Awareness → Accuracy → Variable attention.
   *
   * Step 1 (Input)     — anchor the calendar grid: where you record what's
   *                      coming and going.
   * Step 2 (Awareness) — anchor the Cash Outlook card on the left sidebar:
   *                      this is the user's warning system.
   * Step 3 (Accuracy)  — anchor the day-level reconcile entry point: check
   *                      that the forecast still matches the real checking balance.
   * Step 4 (Attention) — anchor the Needs review panel: variable amounts need
   *                      occasional updates as real statements arrive.
   */
  const STEPS = [
    {
      id: "calendar-add",
      findTarget: findFutureCalendarCellTarget,
      title: "Add bills, paychecks, and transfers",
      context: "Quick overview before you begin.",
      body:
        "Click any calendar day to add income, bills, transfers, or one-time spending. Start simple. You can refine later.",
      ctaLabel: "Next",
      placement: ["below", "above", "right", "left"],
      retryable: true,
      targetExtraClass: "bw-tour-target--calendar-add",
    },
    {
      id: "cash-outlook",
      findTarget: findCashOutlookTarget,
      title: "Know when cash gets tight",
      context: "Quick overview before you begin.",
      body: "BalanceWhiz flags when your projected balance drops below your minimum balance.",
      helper: 'Example: "Alert me if projected balance falls below $1,000."',
      note: "Your minimum balance can be updated anytime in Settings.",
      ctaLabel: "Next",
      placement: ["right", "left", "below", "above"],
      targetExtraClass: "bw-tour-target--cash-outlook",
      dimSelector: ".sidebar",
      supportHighlights: [
        {
          findEl: findNeedsReviewTarget,
          className: "bw-tour-support-highlight--sidebar-soft",
        },
      ],
    },
    {
      id: "reconcile",
      findTarget: findExpectedCalendarConfirmAnchor,
      title: "Keep your forecast accurate",
      body:
        "As life changes, quickly reconcile your forecast to your real checking balance so projected balances stay reliable.",
      helper: "Think of this as checking that your forecast still matches reality.",
      note: "Small updates keep your projected balances trustworthy.",
      ctaLabel: "Next",
      placement: ["below", "above", "right", "left"],
      retryable: true,
      targetExtraClass: "bw-tour-target--reconcile-head",
    },
    {
      id: "needs-review",
      findTarget: findNeedsReviewTarget,
      title: "Some bills change month to month",
      body:
        "BalanceWhiz flags estimated items like credit cards, utilities, or irregular spending. Update them when real amounts arrive.",
      helper: "Examples: credit card payments, electric bills, irregular expenses.",
      note: "You only need to update the items that change.",
      ctaLabel: "Start forecasting",
      placement: ["right", "left", "below", "above"],
      targetExtraClass: "bw-tour-target--needs-review",
      dimSelector: ".sidebar",
      supportHighlights: [
        {
          findEl: findFirstPendingReviewItem,
          className: "bw-tour-support-highlight--pending-item",
        },
      ],
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
  /**
   * Pick the best Cash Outlook anchor for Step 2. Preference order:
   *   1. The active cash pressure alert
   *      (`#sidebarLowBalanceBanner`) if it has rendered content.
   *   2. The high-balance equivalent (`#sidebarHighBalanceBanner`).
   *   3. The Cash Outlook section wrapper
   *      (`#sidebarBalanceThresholdAlerts`) — even when there's no
   *      active warning, this still anchors the user to the area of
   *      the sidebar that *will* show alerts so the educational copy
   *      lands on the right region.
   * Returns null only if the sidebar isn't rendered yet (caller will
   * gracefully advance past the step).
   */
  function isVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findCashOutlookTarget() {
    const low = document.getElementById("sidebarLowBalanceBanner");
    if (isVisible(low)) return low;
    const high = document.getElementById("sidebarHighBalanceBanner");
    if (isVisible(high)) return high;
    const alerts = document.getElementById("sidebarBalanceThresholdAlerts");
    if (isVisible(alerts)) return alerts;
    // Last resort: anchor on the sidebar itself so the educational
    // copy still has a meaningful left-edge anchor.
    const sidebar = document.querySelector("aside.sidebar");
    if (isVisible(sidebar)) return sidebar;
    return null;
  }

  function findFutureCalendarCellTarget() {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const cells = Array.from(
      document.querySelectorAll(".cal-cell[data-iso]:not(.cal-cell--out):not(.cal-cell--before-start)")
    );
    if (!cells.length) return null;

    const todayCell = document.querySelector(".cal-cell:not(.cal-cell--out):not(.cal-cell--before-start) .cal-daynum-num.is-today");
    if (todayCell) {
      const cell = todayCell.closest(".cal-cell");
      if (cell && isVisible(cell)) return cell;
    }

    let firstFuture = null;
    let firstAny = null;
    for (const cell of cells) {
      const iso = cell.getAttribute("data-iso") || "";
      if (!firstAny && isVisible(cell)) firstAny = cell;
      if (iso > todayIso) {
        firstFuture = cell;
        break;
      }
    }
    return firstFuture || firstAny;
  }

  function findExpectedCalendarRowTarget() {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const expectedRows = Array.from(
      document.querySelectorAll(
        ".cal-cell[data-iso]:not(.cal-cell--out):not(.cal-cell--before-start) .cal-day-tx-line--expected"
      )
    ).filter((row) => isVisible(row));
    const rows = expectedRows.length
      ? expectedRows
      : Array.from(
          document.querySelectorAll(
            ".cal-cell[data-iso]:not(.cal-cell--out):not(.cal-cell--before-start) .cal-day-tx-line:not(.cal-day-tx-line--start-balance)"
          )
        ).filter((row) => isVisible(row));
    if (!rows.length) return null;
    const futureOrToday = rows.find((row) => {
      const iso = row.closest(".cal-cell")?.getAttribute("data-iso") || "";
      return iso >= todayIso;
    });
    return futureOrToday || rows[0];
  }

  function findExpectedCalendarConfirmAnchor() {
    const row = findExpectedCalendarRowTarget();
    if (!row) return null;
    return row.closest(".cal-cell")?.querySelector(".cal-daynum") || null;
  }

  function findNeedsReviewTarget() {
    const card = document.getElementById("sidebarPendingTxCard");
    return isVisible(card) ? card : null;
  }

  function findFirstPendingReviewItem() {
    const item = document.querySelector("#sidebarPendingTxList .pending-attn-item");
    return isVisible(item) ? item : null;
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
        <span class="bw-tour-tooltip__counter" data-bw-tour-counter>1 of 4</span>
        <button type="button" class="bw-tour-tooltip__close" data-bw-tour-skip aria-label="Skip tour">×</button>
      </div>
      <h3 class="bw-tour-tooltip__title" id="bwTourTitle" data-bw-tour-title></h3>
      <p class="bw-tour-tooltip__context" data-bw-tour-context hidden></p>
      <p class="bw-tour-tooltip__body" data-bw-tour-body></p>
      <p class="bw-tour-tooltip__helper" data-bw-tour-helper hidden></p>
      <p class="bw-tour-tooltip__note" data-bw-tour-note hidden></p>
      <div class="bw-tour-tooltip__actions">
        <button type="button" class="bw-tour-tooltip__skip" data-bw-tour-skip-link>Skip tour</button>
        <button type="button" class="bw-tour-tooltip__cta" data-bw-tour-next>Next</button>
      </div>
    `;
    document.body.appendChild(tooltipEl);

    tooltipEl.querySelectorAll("[data-bw-tour-skip], [data-bw-tour-skip-link]").forEach((el) => {
      el.addEventListener("click", () => endTour({ skipped: true }));
    });
    tooltipEl.querySelector("[data-bw-tour-next]").addEventListener("click", advanceStep);
    return tooltipEl;
  }

  function liftElement(el, zIndex, zIndexKey, positionKey) {
    const inlineZ = el.style.zIndex;
    const inlinePos = el.style.position;
    el.dataset[zIndexKey] = inlineZ === "" ? "__unset" : inlineZ;
    el.dataset[positionKey] = inlinePos === "" ? "__unset" : inlinePos;
    const computed = window.getComputedStyle(el);
    if (computed.position === "static") {
      el.style.position = "relative";
    }
    el.style.zIndex = String(zIndex);
  }

  function restoreLiftedElement(el, zIndexKey, positionKey) {
    const prevZ = el.dataset[zIndexKey];
    const prevPos = el.dataset[positionKey];
    if (prevZ === "__unset") el.style.removeProperty("z-index");
    else if (prevZ != null) el.style.zIndex = prevZ;
    if (prevPos === "__unset") el.style.removeProperty("position");
    else if (prevPos != null) el.style.position = prevPos;
    delete el.dataset[zIndexKey];
    delete el.dataset[positionKey];
  }

  function clearTargetHighlight() {
    if (currentTargetEl) {
      currentTargetEl.classList.remove("bw-tour-target");
      if (currentTargetExtraClass) {
        currentTargetEl.classList.remove(currentTargetExtraClass);
      }
      restoreLiftedElement(currentTargetEl, "bwTourPrevZIndex", "bwTourPrevPosition");
      currentTargetEl = null;
    }
    currentTargetExtraClass = null;
    for (const item of currentSupportEls) {
      item.el.classList.remove("bw-tour-support-highlight");
      if (item.className) item.el.classList.remove(item.className);
      restoreLiftedElement(item.el, "bwTourSupportPrevZIndex", "bwTourSupportPrevPosition");
    }
    currentSupportEls = [];
    if (currentDimEl) {
      currentDimEl.classList.remove("bw-tour-sidebar-dim");
      currentDimEl = null;
    }
  }

  function applyTargetHighlight(el, opts) {
    clearTargetHighlight();
    if (!el) return;
    currentTargetEl = el;
    liftElement(el, ZINDEX_HIGHLIGHT, "bwTourPrevZIndex", "bwTourPrevPosition");
    el.classList.add("bw-tour-target");
    if (opts && opts.targetExtraClass) {
      el.classList.add(opts.targetExtraClass);
      currentTargetExtraClass = opts.targetExtraClass;
    }
    if (opts && opts.dimSelector) {
      const dimEl = document.querySelector(opts.dimSelector);
      if (dimEl) {
        dimEl.classList.add("bw-tour-sidebar-dim");
        currentDimEl = dimEl;
      }
    }
  }

  function applySupportHighlights(step) {
    const items = Array.isArray(step?.supportHighlights) ? step.supportHighlights : [];
    currentSupportEls = [];
    for (const item of items) {
      const el = item && typeof item.findEl === "function" ? item.findEl() : null;
      if (!el || el === currentTargetEl) continue;
      liftElement(el, ZINDEX_HIGHLIGHT - 1, "bwTourSupportPrevZIndex", "bwTourSupportPrevPosition");
      el.classList.add("bw-tour-support-highlight");
      if (item.className) el.classList.add(item.className);
      currentSupportEls.push({ el, className: item.className || "" });
    }
  }

  // ---------------------------------------------------------------------
  // Tooltip positioning
  // ---------------------------------------------------------------------

  function clamp(num, min, max) {
    return Math.max(min, Math.min(num, max));
  }

  function normalizePlacements(placement) {
    if (Array.isArray(placement) && placement.length) return placement;
    if (placement === "auto" || !placement) return ["below", "above", "right", "left"];
    return [placement];
  }

  function getPlacementCandidate(placement, tr, tw, th, vw, vh, gap, pad) {
    const targetCenterX = tr.left + tr.width / 2;
    const targetCenterY = tr.top + tr.height / 2;
    let left = 0;
    let top = 0;
    let side = "top";
    if (placement === "right") {
      left = tr.right + gap;
      top = targetCenterY - th / 2;
      side = "left";
    } else if (placement === "left") {
      left = tr.left - tw - gap;
      top = targetCenterY - th / 2;
      side = "right";
    } else if (placement === "above") {
      left = targetCenterX - tw / 2;
      top = tr.top - th - gap;
      side = "bottom";
    } else {
      left = targetCenterX - tw / 2;
      top = tr.bottom + gap;
      side = "top";
    }
    const overflow =
      Math.max(0, pad - left) +
      Math.max(0, pad - top) +
      Math.max(0, left + tw - (vw - pad)) +
      Math.max(0, top + th - (vh - pad));
    return {
      left: clamp(left, pad, Math.max(pad, vw - tw - pad)),
      top: clamp(top, pad, Math.max(pad, vh - th - pad)),
      side,
      overflow,
      targetCenterX,
      targetCenterY,
    };
  }

  function positionTooltip(targetEl, placement) {
    if (!tooltipEl) return;
    const gap = 12;
    const pad = 10;
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

    const arrow = tooltipEl.querySelector("[data-bw-tour-arrow]");
    const placements = normalizePlacements(placement);
    const candidates = placements.map((place) => getPlacementCandidate(place, tr, tw, th, vw, vh, gap, pad));
    let chosen = candidates.find((item) => item.overflow === 0) || candidates[0];
    for (const item of candidates) {
      if (item.overflow < chosen.overflow) chosen = item;
    }

    tooltipEl.style.left = `${Math.round(chosen.left)}px`;
    tooltipEl.style.top = `${Math.round(chosen.top)}px`;
    tooltipEl.style.visibility = "";

    if (arrow) {
      arrow.dataset.side = chosen.side;
      if (chosen.side === "left" || chosen.side === "right") {
        const arrowTopWithinTooltip = clamp(chosen.targetCenterY - chosen.top, 20, th - 20);
        arrow.style.top = `${Math.round(arrowTopWithinTooltip)}px`;
        arrow.style.left = "";
      } else {
        const arrowLeftWithinTooltip = clamp(chosen.targetCenterX - chosen.left, 16, tw - 16);
        arrow.style.left = `${Math.round(arrowLeftWithinTooltip)}px`;
        arrow.style.top = "";
      }
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
    currentStepIdx = stepIdx;
    const step = STEPS[stepIdx];
    const target = step.findTarget();
    if (!target) {
      if (step.retryable && (step._retries || 0) < 12) {
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
    const contextEl = tooltipEl.querySelector("[data-bw-tour-context]");
    if (contextEl) {
      if (step.context) {
        contextEl.textContent = step.context;
        contextEl.hidden = false;
      } else {
        contextEl.textContent = "";
        contextEl.hidden = true;
      }
    }
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
    const noteEl = tooltipEl.querySelector("[data-bw-tour-note]");
    if (noteEl) {
      if (step.note) {
        noteEl.textContent = step.note;
        noteEl.hidden = false;
      } else {
        noteEl.textContent = "";
        noteEl.hidden = true;
      }
    }
    tooltipEl.querySelector("[data-bw-tour-next]").textContent = step.ctaLabel || "Next";

    applyTargetHighlight(target, {
      targetExtraClass: step.targetExtraClass,
      dimSelector: step.dimSelector,
    });
    applySupportHighlights(step);
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
    renderStep(currentStepIdx + 1);
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
