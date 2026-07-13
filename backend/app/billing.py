from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from stripe import StripeError
import stripe
from supabase import Client

from app.config import settings
from app.models.billing import BillingSessionResponse, BillingStatus, StripeWebhookResponse
from app.usage import get_usage


PRO_ACCESS_STATUSES = {"active", "trialing"}
SUBSCRIPTION_EVENTS = {
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
}


def stripe_checkout_configured() -> bool:
    return bool(settings.stripe_secret_key and settings.stripe_pro_price_id)


def stripe_portal_configured() -> bool:
    return bool(settings.stripe_secret_key)


def _stripe_webhook_configured() -> bool:
    return bool(settings.stripe_secret_key and settings.stripe_webhook_secret)


def _stripe_ready(configured: bool, detail: str) -> None:
    if not configured:
        raise HTTPException(status_code=503, detail=detail)
    stripe.api_key = settings.stripe_secret_key


def _field(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _timestamp(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return None


def _iso_timestamp(value: Any) -> str | None:
    parsed = _timestamp(value)
    return parsed.isoformat() if parsed else None


def _fetch_subscription_row(db: Client, user_id: str) -> dict | None:
    result = (
        db.table("billing_subscriptions")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return result.data if result and isinstance(result.data, dict) else None


def _find_subscription_owner(
    db: Client,
    stripe_subscription_id: str | None = None,
    stripe_customer_id: str | None = None,
) -> str | None:
    columns = (("stripe_subscription_id", stripe_subscription_id), ("stripe_customer_id", stripe_customer_id))
    for column, value in columns:
        if not value:
            continue
        result = (
            db.table("billing_subscriptions")
            .select("user_id")
            .eq(column, value)
            .maybe_single()
            .execute()
        )
        if result and result.data:
            return result.data["user_id"]

    return None


def _subscription_payload(subscription: Any, user_id: str) -> dict:
    items = _field(_field(subscription, "items", {}), "data", []) or []
    price_id = _field(_field(items[0], "price", {}), "id") if items else None
    return {
        "user_id": user_id,
        "stripe_customer_id": _field(subscription, "customer"),
        "stripe_subscription_id": _field(subscription, "id"),
        "stripe_price_id": price_id,
        "status": _field(subscription, "status", "free") or "free",
        "current_period_end": _iso_timestamp(_field(subscription, "current_period_end")),
        "trial_end": _iso_timestamp(_field(subscription, "trial_end")),
        "cancel_at_period_end": bool(_field(subscription, "cancel_at_period_end", False)),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _upsert_subscription(db: Client, payload: dict) -> None:
    db.table("billing_subscriptions").upsert(payload).execute()


def user_has_pro_access(db: Client, user_id: str) -> bool:
    row = _fetch_subscription_row(db, user_id)
    return bool(row and row.get("status") in PRO_ACCESS_STATUSES)


def fetch_billing_status(db: Client, user_id: str) -> BillingStatus:
    usage = get_usage(db, user_id)
    row = _fetch_subscription_row(db, user_id)
    status = row.get("status") if row else "free"
    is_pro = status in PRO_ACCESS_STATUSES
    return BillingStatus(
        plan="pro" if is_pro else "free",
        status=status,
        is_pro=is_pro,
        free_conversations_remaining=usage["remaining"],
        current_period_end=_timestamp(row.get("current_period_end")) if row else None,
        trial_end=_timestamp(row.get("trial_end")) if row else None,
        cancel_at_period_end=bool(row.get("cancel_at_period_end")) if row else False,
        stripe_configured=stripe_checkout_configured(),
        checkout_available=stripe_checkout_configured() and not is_pro,
        portal_available=stripe_portal_configured() and bool(row and row.get("stripe_customer_id")),
    )


def create_checkout_session(db: Client, user_id: str) -> BillingSessionResponse:
    _stripe_ready(stripe_checkout_configured(), "Stripe checkout is not configured yet")
    row = _fetch_subscription_row(db, user_id)
    if row and row.get("status") in PRO_ACCESS_STATUSES:
        raise HTTPException(status_code=409, detail="This account is already on Mirra Pro")

    session_args: dict[str, Any] = {
        "mode": "subscription",
        "success_url": settings.stripe_success_url,
        "cancel_url": settings.stripe_cancel_url,
        "client_reference_id": user_id,
        "line_items": [{"price": settings.stripe_pro_price_id, "quantity": 1}],
        "allow_promotion_codes": True,
        "metadata": {"user_id": user_id, "plan": "mirra_pro"},
        "subscription_data": {
            "trial_period_days": settings.stripe_trial_days,
            "metadata": {"user_id": user_id, "plan": "mirra_pro"},
        },
    }
    if row and row.get("stripe_customer_id"):
        session_args["customer"] = row["stripe_customer_id"]

    try:
        session = stripe.checkout.Session.create(**session_args)
    except StripeError as exc:
        raise HTTPException(status_code=502, detail=getattr(exc, "user_message", None) or "Stripe request failed") from exc

    url = _field(session, "url")
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a checkout link")
    return BillingSessionResponse(url=url)


def create_portal_session(db: Client, user_id: str) -> BillingSessionResponse:
    _stripe_ready(stripe_portal_configured(), "Stripe customer portal is not configured yet")
    row = _fetch_subscription_row(db, user_id)
    customer_id = row.get("stripe_customer_id") if row else None
    if not customer_id:
        raise HTTPException(status_code=404, detail="No Stripe customer is linked to this account yet")

    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=settings.stripe_portal_return_url,
        )
    except StripeError as exc:
        raise HTTPException(status_code=502, detail=getattr(exc, "user_message", None) or "Stripe request failed") from exc

    url = _field(session, "url")
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a portal link")
    return BillingSessionResponse(url=url)


def _sync_subscription(db: Client, subscription: Any) -> None:
    stripe_subscription_id = _field(subscription, "id")
    stripe_customer_id = _field(subscription, "customer")
    metadata = _field(subscription, "metadata", {}) or {}
    user_id = _field(metadata, "user_id") or _find_subscription_owner(
        db,
        stripe_subscription_id=stripe_subscription_id,
        stripe_customer_id=stripe_customer_id,
    )
    if not user_id:
        return
    _upsert_subscription(db, _subscription_payload(subscription, user_id))


def _handle_checkout_completed(db: Client, session: Any) -> None:
    user_id = _field(session, "client_reference_id") or _field(_field(session, "metadata", {}) or {}, "user_id")
    subscription_id = _field(session, "subscription")
    customer_id = _field(session, "customer")

    if subscription_id:
        try:
            subscription = stripe.Subscription.retrieve(subscription_id)
        except StripeError as exc:
            raise HTTPException(status_code=502, detail="Could not verify Stripe subscription") from exc
        if user_id:
            _upsert_subscription(db, _subscription_payload(subscription, user_id))
        else:
            _sync_subscription(db, subscription)
        return

    if user_id and customer_id:
        existing = _fetch_subscription_row(db, user_id) or {}
        _upsert_subscription(
            db,
            {
                "user_id": user_id,
                "stripe_customer_id": customer_id,
                "stripe_subscription_id": existing.get("stripe_subscription_id"),
                "stripe_price_id": existing.get("stripe_price_id"),
                "status": existing.get("status", "free"),
                "current_period_end": existing.get("current_period_end"),
                "trial_end": existing.get("trial_end"),
                "cancel_at_period_end": bool(existing.get("cancel_at_period_end", False)),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )


def handle_stripe_webhook(db: Client, payload: bytes, signature: str | None) -> StripeWebhookResponse:
    _stripe_ready(_stripe_webhook_configured(), "Stripe webhook signing is not configured yet")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe signature")

    try:
        event = stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook payload") from exc
    except stripe.error.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature") from exc

    event_type = _field(event, "type")
    data_object = _field(_field(event, "data", {}), "object")
    if event_type == "checkout.session.completed":
        _handle_checkout_completed(db, data_object)
    elif event_type in SUBSCRIPTION_EVENTS:
        _sync_subscription(db, data_object)

    return StripeWebhookResponse()
