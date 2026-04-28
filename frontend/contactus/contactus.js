function setErr(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function buildMailtoUrl({ to, subject, body }) {
  const parts = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return `mailto:${to}${qs}`;
}

function getSupportEmail() {
  // Keep address out of HTML; still visible in the mail client once opened.
  const user = "tracyapro";
  const host = "hotmail.com";
  return `${user}@${host}`;
}

const form = document.getElementById("contactForm");
const errEl = document.getElementById("contactErr");
const nameEl = document.getElementById("contactName");
const emailEl = document.getElementById("contactEmail");
const subjectEl = document.getElementById("contactSubject");
const messageEl = document.getElementById("contactMessage");

if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    setErr(errEl, "");

    const name = String(nameEl?.value || "").trim();
    const email = String(emailEl?.value || "").trim();
    const subject = String(subjectEl?.value || "").trim();
    const msg = String(messageEl?.value || "").trim();

    if (!name) return setErr(errEl, "Name is required.");
    if (!email) return setErr(errEl, "Email is required.");
    if (!msg) return setErr(errEl, "Message is required.");

    const to = getSupportEmail();
    const fullSubject = subject ? `BalanceWhiz: ${subject}` : "BalanceWhiz: Contact Us";
    const body =
      `Name: ${name}\n` +
      `Email: ${email}\n\n` +
      `${msg}\n`;

    window.location.href = buildMailtoUrl({ to, subject: fullSubject, body });
  });
}

