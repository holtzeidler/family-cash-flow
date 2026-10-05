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

  function paintLoggedIn() {
    document.documentElement.setAttribute("data-bw-home-auth", "in");
  }

  function paintLoggedOut() {
    document.documentElement.removeAttribute("data-bw-home-auth");
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
          paintLoggedIn();
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

  var logoutBtn = document.getElementById("homeLogoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);

  window.addEventListener("pageshow", refreshHomeAuth);
})();
