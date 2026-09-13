from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request


BASE_URL = os.environ.get("MIRRA_BACKEND_URL", "http://localhost:8000").rstrip("/")
REQUIRE_MODEL = os.environ.get("MIRRA_REQUIRE_MODEL", "").lower() in {"1", "true", "yes"}
REQUIRE_STRIPE = os.environ.get("MIRRA_REQUIRE_STRIPE", "").lower() in {"1", "true", "yes"}


def request(
    path: str,
    method: str = "GET",
    body: dict | None = None,
    headers: dict | None = None,
) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req_headers = dict(headers or {})
    if body is not None:
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
        headers=req_headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8")
        return exc.code, json.loads(payload) if payload else {}


def main() -> int:
    health_status, health = request("/health")
    print("health", health_status, health)
    if health_status != 200:
        return 1

    status_code, status = request("/auth/status")
    print("auth_status", status_code, status)
    if status_code != 200:
        return 1

    if not status.get("username_password_ready"):
        print("username smoke skipped: configure SUPABASE_SERVICE_ROLE_KEY")
        return 2

    username = f"smoke_{int(time.time())}"
    password = "smoketest123"
    signup_code, signup = request(
        "/auth/username/sign-up",
        "POST",
        {"username": username, "password": password},
    )
    print("username_sign_up", signup_code, {"has_access_token": bool(signup.get("access_token"))})
    if signup_code != 200 or not signup.get("access_token"):
        return 1

    signin_code, signin = request(
        "/auth/username/sign-in",
        "POST",
        {"username": username, "password": password},
    )
    print("username_sign_in", signin_code, {"has_access_token": bool(signin.get("access_token"))})
    if signin_code != 200 or not signin.get("access_token"):
        return 1

    auth_headers = {"Authorization": f"Bearer {signin['access_token']}"}
    profile_code, profile = request("/profile/summary", headers=auth_headers)
    print("profile_summary", profile_code, {"total_conversations": profile.get("total_conversations")})
    if profile_code != 200:
        return 1

    export_code, export = request("/account/export", headers=auth_headers)
    print(
        "account_export",
        export_code,
        {"debriefs": len(export.get("debriefs", [])), "has_settings": bool(export.get("settings"))},
    )
    if export_code != 200:
        return 1

    progress_code, progress = request("/analytics/progress?weeks=1", headers=auth_headers)
    print("progress_summary", progress_code, {"weeks": len(progress.get("weeks", []))})
    if progress_code != 200 or not progress.get("weeks"):
        return 1

    settings_code, settings = request("/settings", headers=auth_headers)
    print("settings", settings_code, {"coaching_tone": settings.get("coaching_tone")})
    if settings_code != 200:
        return 1

    settings_patch_code, patched_settings = request(
        "/settings",
        "PATCH",
        {
            "coaching_tone": "curious_gentle",
            "reflection_reminders": True,
            "weekly_summary_day": "wednesday",
            "weekly_summary_time": "night",
        },
        auth_headers,
    )
    print(
        "settings_patch",
        settings_patch_code,
        {
            "coaching_tone": patched_settings.get("coaching_tone"),
            "weekly_summary": f"{patched_settings.get('weekly_summary_day')} {patched_settings.get('weekly_summary_time')}",
        },
    )
    if (
        settings_patch_code != 200
        or patched_settings.get("coaching_tone") != "curious_gentle"
        or patched_settings.get("weekly_summary_day") != "wednesday"
        or patched_settings.get("weekly_summary_time") != "night"
    ):
        return 1

    billing_code, billing = request("/billing/status", headers=auth_headers)
    print(
        "billing_status",
        billing_code,
        {"plan": billing.get("plan"), "stripe_configured": billing.get("stripe_configured")},
    )
    if billing_code != 200:
        return 1

    if billing.get("stripe_configured"):
        checkout_code, checkout = request("/billing/checkout", "POST", headers=auth_headers)
        print("billing_checkout", checkout_code, {"has_url": bool(checkout.get("url"))})
        if checkout_code != 200 or not checkout.get("url"):
            return 1
    elif REQUIRE_STRIPE:
        print("billing smoke failed: configure STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID")
        return 1
    else:
        print("billing checkout skipped: configure Stripe keys to create a checkout session")

    reflect_code, reflect = request(
        "/reflect",
        "POST",
        {"prompt": "What should I notice?", "messages": []},
        auth_headers,
    )
    print("reflect", reflect_code, {"has_reply": bool(reflect.get("reply")), "used_model": bool(reflect.get("used_model"))})
    if reflect_code != 200 or not reflect.get("reply"):
        return 1
    if REQUIRE_MODEL and not reflect.get("used_model"):
        print("reflect model smoke failed: configure OPENAI_API_KEY")
        return 1

    if not status.get("google_enabled"):
        print("google smoke skipped: enable Google provider in Supabase")
        return 2

    print("auth smoke passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
