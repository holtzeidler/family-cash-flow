/**
 * Hero forecast story: subtle alert emphasis when the demo scrolls into view.
 * Static layout carries the story; this only draws attention to the alert once.
 */
(function () {
  var hub = document.getElementById("landingHeroForecast");
  if (!hub) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var alertEl = hub.querySelector(".landing-hero-story__alert");
  if (!alertEl) return;

  var emphasized = false;

  function emphasizeAlert() {
    if (emphasized) return;
    emphasized = true;
    alertEl.classList.add("is-emphasized");
    window.setTimeout(function () {
      alertEl.classList.remove("is-emphasized");
    }, 2200);
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            window.setTimeout(emphasizeAlert, 900);
            io.disconnect();
          }
        });
      },
      { root: null, threshold: 0.35, rootMargin: "0px 0px -4% 0px" }
    );
    io.observe(hub);
  } else {
    window.setTimeout(emphasizeAlert, 900);
  }
})();
