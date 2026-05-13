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
  let currentTargetExtraClass = null;
  let currentDimEl = null;
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
   * Tour progression: Input → Awareness → Accuracy.
   *
   * Step 1 (Input)     — anchor the calendar grid: where you record what's
   *                      coming and going.
   * Step 2 (Awareness) — anchor the Cash Outlook card on the left sidebar:
   *                      this is the user's "warning system." The tooltip
   *                      sits to the right of the card with the arrow
   *                      pointing into it.
   * Step 3 (Accuracy)  — anchor the Needs review card: confirm cleared
   *                      transactions so the forecast stays accurate.
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
      id: "cash-outlook",
      findTarget: findCashOutlookTarget,
      title: "Know when cash gets tight",
      // Two short paragraphs separated by a blank line. The tooltip body
      // CSS uses `white-space: pre-line` so the newline becomes a visible
      // paragraph gap.
      body:
        "BalanceWhiz watches your upcoming balances and alerts you before cash drops below your comfort zone.\n\nYou can set your own minimum checking balance anytime in Settings.",
      helper: 'Example: "Warn me if checking falls below $1,000."',
      ctaLabel: "Next",
      placement: "right",
      // Adds a subtle glow + brighter background on the highlighted card
      // and slightly dims unrelated sidebar siblings so the user's eye
      // lands on the warning system.
      targetExtraClass: "bw-tour-target--cash-outlook",
      dimSelector: ".sidebar",
    },
    {
      id: "reconcile",
      findTarget: () => document.getElementById("sidebarPendingTxCard"),
      title: "Keep your forecast accurate",
      body:
        "As transactions clear your account, mark them confirmed so your forecast stays accurate.",
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
  /**
   * Pick the best Cash Outlook anchor for Step 2. Preference order:
   *   1. The active "Transfer cash before…" warning card
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
  function findCashOutlookTarget() {
    function isVisible(el) {
      if (!el) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
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
      if (currentTargetExtraClass) {
        currentTargetEl.classList.remove(currentTargetExtraClass);
      }
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
    currentTargetExtraClass = null;
    if (currentDimEl) {
      currentDimEl.classList.remove("bw-tour-sidebar-dim");
      currentDimEl = null;
    }
  }

  function applyTargetHighlight(el, opts) {
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

  // ---------------------------------------------------------------------
  // Tooltip positioning
  // ---------------------------------------------------------------------

  function positionTooltip(targetEl, placement) {
    if (!tooltipEl) return;
    const margin = 14;
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

    // Side placements (right / left) anchor the tooltip beside the
    // target with a horizontal arrow pointing into the highlighted
    // card. Auto-flip if there isn't enough horizontal room.
    const isHorizontal = placement === "right" || placement === "left";
    if (isHorizontal) {
      let placeRight = placement === "right";
      const spaceRight = vw - tr.right;
      const spaceLeft = tr.left;
      if (placeRight && spaceRight < tw + margin && spaceLeft >= tw + margin) {
        placeRight = false;
      } else if (!placeRight && spaceLeft < tw + margin && spaceRight >= tw + margin) {
        placeRight = true;
      }

      let left = placeRight ? tr.right + margin : tr.left - tw - margin;
      left = Math.max(8, Math.min(left, vw - tw - 8));

      // Vertical: align the tooltip's vertical center with the
      // target's center, slightly biased downward so the arrow lands
      // inside the card body rather than at the very top edge. Then
      // clamp to viewport.
      const targetCenterY = tr.top + tr.height / 2;
      let top = targetCenterY - th / 2 + 8;
      top = Math.max(8, Math.min(top, vh - th - 8));

      tooltipEl.style.left = `${Math.round(left)}px`;
      tooltipEl.style.top = `${Math.round(top)}px`;
      tooltipEl.style.visibility = "";

      if (arrow) {
        arrow.dataset.side = placeRight ? "left" : "right";
        const arrowTopWithinTooltip = Math.max(20, Math.min(th - 20, targetCenterY - top));
        arrow.style.top = `${Math.round(arrowTopWithinTooltip)}px`;
        arrow.style.left = "";
      }
      return;
    }

    // Vertical (above/below/auto) placement.
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
    if (arrow) {
      arrow.dataset.side = placeBelow ? "top" : "bottom";
      const arrowLeftWithinTooltip = Math.max(16, Math.min(tw - 16, targetCenterX - left));
      arrow.style.left = `${Math.round(arrowLeftWithinTooltip)}px`;
      arrow.style.top = "";
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

    applyTargetHighlight(target, {
      targetExtraClass: step.targetExtraClass,
      dimSelector: step.dimSelector,
    });
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
