"""Welcome email CTA goes to login, then the calendar. Other emails stay unchanged."""

from app.email_templates import (
    build_trial_ending_email_content,
    build_welcome_email_content,
    render_transactional_html,
    welcome_forecast_cta_url,
)


def test_welcome_cta_uses_login_then_calendar():
    url = welcome_forecast_cta_url("https://balancewhiz.com/")
    assert url == "https://balancewhiz.com/login.html?next=/calendar"
    content = build_welcome_email_content(app_url="https://staging.balancewhiz.com", first_name="Tracy")
    assert content.cta_label == "Go to my forecast"
    assert content.cta_url == "https://staging.balancewhiz.com/login.html?next=/calendar"
    html = render_transactional_html(content, app_url="https://staging.balancewhiz.com")
    assert "https://staging.balancewhiz.com/login.html?next=/calendar" in html
    assert "token=" not in content.cta_url


def test_welcome_cta_rejects_non_http_base():
    assert welcome_forecast_cta_url("javascript:alert(1)") == ""
    assert welcome_forecast_cta_url("") == ""


def test_trial_ending_email_is_unchanged():
    content = build_trial_ending_email_content(app_url="https://balancewhiz.com")
    assert content.cta_label == "Choose a plan"
    assert "login.html" not in content.cta_url
