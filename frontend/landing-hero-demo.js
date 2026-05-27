/**
 * Subtle hero forecast micro-demo: watch day → alert → paycheck → rest.
 * Dates are set by landing-hero-dates.js relative to today.
 * Respects prefers-reduced-motion; opacity / fill / stroke only (no layout shift).
 */
(function () {
  var hub = document.getElementById("landingHeroForecast");
  if (!hub) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var STEP_CLASSES = ["is-step-watch", "is-step-alert", "is-step-paycheck"];
  var STEP_MS = [1000, 1200, 1000];
  var REST_MS = 700;
  var LOOP_PAUSE_MS = 12000;
  var INITIAL_DELAY_MS = 900;

  var timer = null;
  var started = false;
  var running = false;

  function clearSteps() {
    STEP_CLASSES.forEach(function (cls) {
      hub.classList.remove(cls);
    });
  }

  function setStep(index) {
    clearSteps();
    if (index >= 0 && index < STEP_CLASSES.length) {
      hub.classList.add(STEP_CLASSES[index]);
    }
  }

  function stopTimers() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    running = false;
  }

  function schedule(ms, fn) {
    timer = setTimeout(fn, ms);
  }

  function runSequence() {
    if (running) return;
    running = true;
    var i = 0;

    function next() {
      if (i < STEP_CLASSES.length) {
        setStep(i);
        schedule(STEP_MS[i], function () {
          i += 1;
          next();
        });
        return;
      }
      setStep(-1);
      schedule(REST_MS, function () {
        running = false;
        schedule(LOOP_PAUSE_MS, function () {
          if (started) runSequence();
        });
      });
    }

    next();
  }

  function start() {
    if (started) return;
    started = true;
    schedule(INITIAL_DELAY_MS, runSequence);
  }

  function reset() {
    stopTimers();
    clearSteps();
    started = false;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopTimers();
    else if (started) schedule(LOOP_PAUSE_MS, runSequence);
  });

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        var visible = entries.some(function (e) {
          return e.isIntersecting;
        });
        if (visible) start();
        else reset();
      },
      { root: null, threshold: 0.15, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(hub);
  } else {
    start();
  }
})();
