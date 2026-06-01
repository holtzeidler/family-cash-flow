/**
 * Hero forecast calendar: subtle insight emphasis when the demo scrolls into view.
 */
(function () {
  var hub = document.getElementById("landingHeroForecast");
  if (!hub) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var insightEl = hub.querySelector(".landing-hero-cal__insight");
  if (!insightEl) return;

  var emphasized = false;

  function emphasizeInsight() {
    if (emphasized) return;
    emphasized = true;
    insightEl.classList.add("is-emphasized");
    window.setTimeout(function () {
      insightEl.classList.remove("is-emphasized");
    }, 2200);
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            window.setTimeout(emphasizeInsight, 900);
            io.disconnect();
          }
        });
      },
      { root: null, threshold: 0.35, rootMargin: "0px 0px -4% 0px" }
    );
    io.observe(hub);
  } else {
    window.setTimeout(emphasizeInsight, 900);
  }
})();
