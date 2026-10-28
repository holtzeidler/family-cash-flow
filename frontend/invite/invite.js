(function () {
  const homeBtn = document.getElementById("inviteHomeBtn");
  if (homeBtn) {
    homeBtn.addEventListener("click", () => {
      window.location.href = "/";
    });
  }
})();
