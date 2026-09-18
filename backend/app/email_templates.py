"""Shared BalanceWhiz transactional email HTML + plain-text templates.

Individual emails supply content; this module owns the shell (header, card,
typography, CTA, footer, preheader). Table-based markup for Outlook. No JS,
no web fonts, no attached images.
"""

from __future__ import annotations

import html
from dataclasses import dataclass

SITE_URL = "https://balancewhiz.com"
SITE_NAME = "BalanceWhiz"
TAGLINE = "See your cash flow before it happens."
FOOTER_SUPPORT = "Questions? Reply to this email or contact support."
SUPPORT_MAILTO = "mailto:support@balancewhiz.com"

# App tokens: --bg, --text, --muted / slate helpers, --accent (CTA), logo wordmark.
PAGE_BG = "#E6E7EA"
CARD_BG = "#FFFFFF"
TEXT = "#111827"
TEXT_SECONDARY = "#5E6876"
MUTED = "#64748B"
CTA_BG = "#0B3D2E"
CTA_FG = "#FFFFFF"
BORDER = "#E2E5EA"
WORDMARK_BALANCE = "#5E6876"
WORDMARK_WHIZ = "#0F5B43"

_FONT = "Arial, Helvetica, sans-serif"


@dataclass(frozen=True)
class TransactionalEmailContent:
    """Fields one transactional email fills in. The shell is not duplicated."""

    subject: str
    heading: str
    body: str
    preheader: str = ""
    cta_label: str = ""
    cta_url: str = ""
    support_line: str = ""
    additional_text: str = ""


def _esc(value: str) -> str:
    return html.escape((value or "").strip(), quote=True)


def _safe_http_url(url: str) -> str:
    raw = (url or "").strip()
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw
    return ""


def _paragraphs(text: str) -> list[str]:
    chunks = [part.strip() for part in (text or "").replace("\r\n", "\n").split("\n\n")]
    return [part for part in chunks if part]


def _p_html(text: str, *, color: str, size: str = "16px", weight: str = "400", extra: str = "") -> str:
    return (
        f'<p style="margin:0 0 16px;font-family:{_FONT};font-size:{size};'
        f'line-height:1.55;font-weight:{weight};color:{color};{extra}">{_esc(text)}</p>'
    )


def _cta_vml_width(label: str) -> int:
    return min(360, max(180, 8 * len(label) + 56))


def render_cta_html(*, label: str, url: str) -> str:
    """Outlook-safe primary button (VML + padded table cell)."""
    href = _safe_http_url(url)
    text = (label or "").strip()
    if not href or not text:
        return ""
    esc_label = _esc(text)
    esc_href = _esc(href)
    width = _cta_vml_width(text)
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">
  <tr>
    <td align="left">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{esc_href}" style="height:44px;v-text-anchor:middle;width:{width}px;" arcsize="12%" stroke="f" fillcolor="{CTA_BG}">
        <w:anchorlock/>
        <center style="color:{CTA_FG};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">{esc_label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="{esc_href}" style="display:inline-block;background-color:{CTA_BG};color:{CTA_FG};font-family:{_FONT};font-size:16px;font-weight:700;line-height:1.25;text-decoration:none;padding:12px 22px;border-radius:8px;mso-hide:all;">{esc_label}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>
""".strip()


def _wordmark_html() -> str:
    site = _esc(SITE_URL)
    return (
        f'<a href="{site}" style="text-decoration:none;">'
        f'<span style="font-family:{_FONT};font-size:22px;line-height:1.2;font-weight:600;'
        f'color:{WORDMARK_BALANCE};letter-spacing:-0.03em;">Balance</span>'
        f'<span style="font-family:{_FONT};font-size:22px;line-height:1.2;font-weight:700;'
        f'color:{WORDMARK_WHIZ};letter-spacing:-0.03em;">Whiz</span>'
        f"</a>"
    )


def render_transactional_html(content: TransactionalEmailContent) -> str:
    heading = (content.heading or "").strip()
    body_parts = _paragraphs(content.body)
    extra_parts = _paragraphs(content.additional_text)
    support = (content.support_line or "").strip()
    preheader = (content.preheader or "").strip()
    subject = (content.subject or "").strip() or SITE_NAME
    cta = render_cta_html(label=content.cta_label, url=content.cta_url)

    body_html = "".join(_p_html(part, color=TEXT) for part in body_parts)
    extra_html = "".join(_p_html(part, color=TEXT) for part in extra_parts)
    heading_html = (
        f'<h1 style="margin:0 0 16px;font-family:{_FONT};font-size:24px;line-height:1.3;'
        f'font-weight:700;color:{TEXT};">{_esc(heading)}</h1>'
        if heading
        else ""
    )
    support_html = (
        _p_html(support, color=MUTED, size="14px", extra="margin:0;")
        if support
        else ""
    )
    # Visible preview line — first text in the message, no hidden/1px/filler cloaking.
    preheader_html = (
        _p_html(preheader, color=MUTED, size="14px", extra="margin:0 0 16px;max-width:600px;text-align:left;")
        if preheader
        else ""
    )

    inner = f"{heading_html}{body_html}{extra_html}{cta}{support_html}"
    site = _esc(SITE_URL)
    support_mailto = _esc(SUPPORT_MAILTO)

    return f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>{_esc(subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, a {{ -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }}
    table, td {{ mso-table-lspace: 0pt; mso-table-rspace: 0pt; }}
    img {{ -ms-interpolation-mode: bicubic; border: 0; }}
    @media only screen and (max-width: 620px) {{
      .email-card {{ width: 100% !important; }}
      .email-pad {{ padding-left: 20px !important; padding-right: 20px !important; }}
    }}
  </style>
</head>
<body style="margin:0;padding:0;background-color:{PAGE_BG};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:{PAGE_BG};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        {preheader_html}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="email-card" style="width:600px;max-width:600px;background-color:{CARD_BG};border:1px solid {BORDER};border-radius:12px;">
          <tr>
            <td class="email-pad" style="padding:28px 36px 12px;border-bottom:1px solid {BORDER};">
              {_wordmark_html()}
            </td>
          </tr>
          <tr>
            <td class="email-pad" style="padding:28px 36px 8px;">
              {inner}
            </td>
          </tr>
          <tr>
            <td class="email-pad" style="padding:20px 36px 28px;border-top:1px solid {BORDER};">
              <p style="margin:0 0 4px;font-family:{_FONT};font-size:14px;line-height:1.4;font-weight:700;color:{TEXT};">
                <a href="{site}" style="color:{TEXT};text-decoration:none;">{_esc(SITE_NAME)}</a>
              </p>
              <p style="margin:0 0 12px;font-family:{_FONT};font-size:13px;line-height:1.45;color:{TEXT_SECONDARY};">{_esc(TAGLINE)}</p>
              <p style="margin:0;font-family:{_FONT};font-size:13px;line-height:1.45;color:{MUTED};">
                Questions? Reply to this email or <a href="{support_mailto}" style="color:{MUTED};text-decoration:underline;">contact support</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def render_transactional_text(content: TransactionalEmailContent) -> str:
    lines: list[str] = []
    preheader = (content.preheader or "").strip()
    if preheader:
        lines.append(preheader)
        lines.append("")
    heading = (content.heading or "").strip()
    if heading:
        lines.append(heading)
        lines.append("")
    for part in _paragraphs(content.body):
        lines.append(part)
        lines.append("")
    for part in _paragraphs(content.additional_text):
        lines.append(part)
        lines.append("")
    cta_label = (content.cta_label or "").strip()
    cta_url = _safe_http_url(content.cta_url)
    if cta_label and cta_url:
        lines.append(f"{cta_label}:")
        lines.append(cta_url)
        lines.append("")
    support = (content.support_line or "").strip()
    if support:
        lines.append(support)
        lines.append("")
    lines.append("—")
    lines.append(SITE_NAME)
    lines.append(TAGLINE)
    lines.append(SITE_URL)
    lines.append("")
    lines.append(FOOTER_SUPPORT)
    text = "\n".join(lines).strip() + "\n"
    return text


def render_transactional_email(content: TransactionalEmailContent) -> tuple[str, str]:
    """Return (html_body, text_body) for a transactional message."""
    return render_transactional_html(content), render_transactional_text(content)
