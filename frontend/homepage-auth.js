(function () {
  var TOKEN_KEY = "bw_api_access_token";
  var requestSeq = 0;
  var logoutBusy = false;

  function readStoredApiAccessToken() {
    try {
      var sessionToken = sessionStorage.getItem(TOKEN_KEY);
      if (sessionToken && String(sessionToken).trim()) return String(sessionToken).trim();
    } catch (_) {}
    try {
      var persistentToken = localStorage.getItem(TOKEN_KEY);
      if (persistentToken && String(persistentToken).trim()) return String(persistentToken).trim();
    } catch (_) {}
    return "";
  }

  if (readStoredApiAccessToken()) {
    document.documentElement.setAttribute("data-bw-home-auth", "in");
    if (!document.documentElement.getAttribute("data-bw-onboarding")) {
      document.documentElement.setAttribute("data-bw-onboarding", "unknown");
    }
  }
  if (window.__bwPublicAuthInit) return;
  window.__bwPublicAuthInit = true;

  function clearStoredApiAccessToken() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  }

  function apiBaseUrl() {
    var raw = window.API_BASE && window.API_BASE !== "__API_BASE__" ? String(window.API_BASE).trim() : "";
    return raw.replace(/\/+$/, "");
  }

  function authHeaders() {
    var headers = { Accept: "application/json" };
    var token = readStoredApiAccessToken();
    if (token) headers.Authorization = "Bearer " + token;
    return headers;
  }

  function paintMemberLinks() {
    var signedIn = document.documentElement.getAttribute("data-bw-home-auth") === "in";
    var links = document.querySelectorAll("#homeForecastLink, a.home-cta--member");
    for (var i = 0; i < links.length; i++) {
      if (signedIn) links[i].setAttribute("href", "/calendar/");
      else links[i].removeAttribute("href");
    }
  }

  function paintLoggedIn() {
    document.documentElement.setAttribute("data-bw-home-auth", "in");
    if (!document.documentElement.getAttribute("data-bw-onboarding")) {
      document.documentElement.setAttribute("data-bw-onboarding", "unknown");
    }
    paintMemberLinks();
  }

  function paintLoggedOut() {
    document.documentElement.removeAttribute("data-bw-home-auth");
    document.documentElement.removeAttribute("data-bw-onboarding");
    paintMemberLinks();
  }

  function refreshHomeAuth() {
    var requestId = ++requestSeq;
    if (readStoredApiAccessToken()) paintLoggedIn();
    fetch(apiBaseUrl() + "/api/auth/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: authHeaders(),
    })
      .then(function (res) {
        if (requestId !== requestSeq) return;
        if (res.status === 200) {
          res
            .json()
            .then(function (body) {
              if (requestId !== requestSeq) return;
              document.documentElement.setAttribute(
                "data-bw-onboarding",
                body && body.needs_onboarding ? "needs" : "done"
              );
              paintLoggedIn();
            })
            .catch(function () {
              if (requestId !== requestSeq) return;
              document.documentElement.setAttribute("data-bw-onboarding", "unknown");
              paintLoggedIn();
            });
          return;
        }
        if (res.status === 401) {
          clearStoredApiAccessToken();
          paintLoggedOut();
        }
      })
      .catch(function () {});
  }

  function logout() {
    if (logoutBusy) return;
    logoutBusy = true;
    requestSeq += 1;
    var button = document.getElementById("homeLogoutBtn");
    if (button) button.disabled = true;
    fetch(apiBaseUrl() + "/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: authHeaders(),
    })
      .catch(function () {})
      .then(function () {
        clearStoredApiAccessToken();
        var path = window.location.pathname || "/";
        if (path === "/" || path === "/index.html") window.location.reload();
        else window.location.href = "/";
      });
  }

  function bindPublicAuth() {
    var logoutBtn = document.getElementById("homeLogoutBtn");
    if (logoutBtn && logoutBtn.getAttribute("data-bw-bound") !== "1") {
      logoutBtn.setAttribute("data-bw-bound", "1");
      logoutBtn.addEventListener("click", logout);
    }
    paintMemberLinks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindPublicAuth);
  } else {
    bindPublicAuth();
  }
  window.addEventListener("pageshow", function () {
    bindPublicAuth();
    refreshHomeAuth();
  });

  function closePublicNavs() {
    var openNavs = document.querySelectorAll(".public-nav.is-open");
    Array.prototype.forEach.call(openNavs, function (nav) {
      nav.classList.remove("is-open");
      var toggle = nav.querySelector(".public-nav__toggle");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest && event.target.closest(".public-nav__toggle");
    if (toggle) {
      var nav = toggle.closest(".public-nav");
      var willOpen = nav && !nav.classList.contains("is-open");
      closePublicNavs();
      if (willOpen) {
        nav.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
      }
      return;
    }
    if (!event.target.closest || !event.target.closest(".public-nav")) closePublicNavs();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    var open = document.querySelector(".public-nav.is-open");
    if (!open) return;
    closePublicNavs();
    var toggle = open.querySelector(".public-nav__toggle");
    if (toggle) toggle.focus();
  });
})();
