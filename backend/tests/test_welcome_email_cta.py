"""Welcome email CTA goes to login, then the calendar. Other emails stay unchanged."""

from datetime import datetime

from app.email_templates import (
    build_trial_ending_1d_email_content,
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


def test_trial_ending_email_opens_checkout():
    content = build_trial_ending_email_content(app_url="https://balancewhiz.com")
    assert content.subject == "Your BalanceWhiz trial ends in 3 days"
    assert content.cta_label == "Choose a plan"
    assert content.cta_url == "https://balancewhiz.com/checkout/"


def test_one_day_trial_reminder_uses_the_checkout_for_that_environment():
    ends = datetime(2026, 10, 16, 15, 0, 0)
    production = build_trial_ending_1d_email_content(app_url="https://balancewhiz.com", trial_ends_on=ends)
    assert production.subject == "Your BalanceWhiz trial ends tomorrow."
    assert production.heading == "Your free trial ends tomorrow."
    assert production.cta_label == "Choose a plan"
    assert production.cta_url == "https://balancewhiz.com/checkout/"
    assert "tomorrow, October 16, 2026" in production.body
    assert "view-only" in production.support_line
    assert "won’t be charged" in production.support_line
    assert "remain available" in production.support_line
    html = render_transactional_html(production, app_url="https://balancewhiz.com")
    assert "https://balancewhiz.com/checkout/" in html
    assert "Your free trial ends tomorrow." in html

    staging = build_trial_ending_1d_email_content(app_url="https://staging.balancewhiz.com", trial_ends_on=ends)
    assert staging.cta_url == "https://staging.balancewhiz.com/checkout/"
    staging_html = render_transactional_html(staging, app_url="https://staging.balancewhiz.com")
    assert "https://staging.balancewhiz.com/checkout/" in staging_html
    assert "https://balancewhiz.com/checkout/" not in staging.cta_url
