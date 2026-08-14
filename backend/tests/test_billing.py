from dataclasses import dataclass
from io import BytesIO

from fastapi.testclient import TestClient

from app import billing
from app.auth import verify_token
from app.db import get_db
from app.main import app


@dataclass
class _Result:
    data: object


class _Table:
    def __init__(self, db: "_Db", name: str):
        self.db = db
        self.name = name
        self.filters: list[tuple[str, object]] = []
        self.selected = "*"
        self._insert: dict | None = None
        self._upsert: dict | None = None

    def select(self, selected="*", *_args, **_kwargs):
        self.selected = selected
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def maybe_single(self):
        return self

    def insert(self, row: dict):
        self._insert = row
        return self

    def upsert(self, row: dict):
        self._upsert = row
        return self

    def execute(self):
        if self.name == "debrief_usage":
            return _Result({"count": self.db.used} if self.db.used else None)

        if self.name == "user_settings":
            return _Result(None)

        if self.name == "debriefs" and self._insert is not None:
            row = {
                "id": "00000000-0000-0000-0000-000000000777",
                "created_at": "2026-07-07T00:00:00+00:00",
                **self._insert,
            }
            self.db.debriefs.append(row)
            return _Result([row])

        if self.name == "billing_subscriptions":
            if self._upsert is not None:
                self.db.billing[self._upsert["user_id"]] = self._upsert
                return _Result([self._upsert])

            rows = list(self.db.billing.values())
            for key, value in self.filters:
                rows = [row for row in rows if row.get(key) == value]
            row = rows[0] if rows else None
            if self.selected == "user_id" and row:
                return _Result({"user_id": row["user_id"]})
            return _Result(row)

        raise AssertionError(f"Unexpected table {self.name}")


class _Db:
    def __init__(self, used: int = 0, billing_row: dict | None = None):
        self.used = used
        self.billing = {}
        if billing_row:
            self.billing[billing_row["user_id"]] = billing_row
        self.debriefs: list[dict] = []

    def table(self, name: str):
        return _Table(self, name)


def _client(db: _Db) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[verify_token] = lambda: "user-1"
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_billing_status_defaults_to_free_when_no_subscription(monkeypatch):
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "")
    monkeypatch.setattr(billing.settings, "stripe_pro_price_id", "")

    r = _client(_Db(used=1)).get("/billing/status")
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "free"
    assert body["is_pro"] is False
    assert body["free_conversations_remaining"] == 4
    assert body["stripe_configured"] is False


def test_checkout_requires_stripe_configuration(monkeypatch):
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "")
    monkeypatch.setattr(billing.settings, "stripe_pro_price_id", "")

    r = _client(_Db()).post("/billing/checkout")

    assert r.status_code == 503
    assert r.json()["detail"] == "Stripe checkout is not configured yet"


def test_checkout_creates_trial_subscription_session(monkeypatch):
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(billing.settings, "stripe_pro_price_id", "price_mirra_pro")
    monkeypatch.setattr(billing.settings, "stripe_trial_days", 14)
    call: dict = {}

    def fake_create(**kwargs):
        call.update(kwargs)
        return {"url": "https://checkout.stripe.test/session"}

    monkeypatch.setattr(billing.stripe.checkout.Session, "create", fake_create)

    r = _client(_Db()).post("/billing/checkout")

    assert r.status_code == 200
    assert r.json()["url"] == "https://checkout.stripe.test/session"
    assert call["mode"] == "subscription"
    assert call["line_items"] == [{"price": "price_mirra_pro", "quantity": 1}]
    assert call["subscription_data"]["trial_period_days"] == 14
    assert call["subscription_data"]["metadata"]["user_id"] == "user-1"


def test_portal_uses_existing_stripe_customer(monkeypatch):
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "sk_test_123")
    db = _Db(
        billing_row={
            "user_id": "user-1",
            "stripe_customer_id": "cus_123",
            "stripe_subscription_id": "sub_123",
            "status": "active",
        }
    )
    call: dict = {}

    def fake_create(**kwargs):
        call.update(kwargs)
        return {"url": "https://billing.stripe.test/session"}

    monkeypatch.setattr(billing.stripe.billing_portal.Session, "create", fake_create)

    r = _client(db).post("/billing/portal")

    assert r.status_code == 200
    assert r.json()["url"] == "https://billing.stripe.test/session"
    assert call["customer"] == "cus_123"


def test_webhook_updates_subscription_status(monkeypatch):
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(billing.settings, "stripe_webhook_secret", "whsec_123")
    db = _Db()
    event = {
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": "sub_123",
                "customer": "cus_123",
                "status": "trialing",
                "current_period_end": 1783555200,
                "trial_end": 1783555200,
                "cancel_at_period_end": False,
                "metadata": {"user_id": "user-1"},
                "items": {"data": [{"price": {"id": "price_mirra_pro"}}]},
            }
        },
    }
    monkeypatch.setattr(billing.stripe.Webhook, "construct_event", lambda *_args, **_kwargs: event)

    r = _client(db).post("/billing/webhook", content=b"{}", headers={"Stripe-Signature": "sig"})

    assert r.status_code == 200
    assert db.billing["user-1"]["status"] == "trialing"
    assert db.billing["user-1"]["stripe_customer_id"] == "cus_123"
    assert db.billing["user-1"]["stripe_price_id"] == "price_mirra_pro"


def test_checkout_completed_webhook_uses_session_user_id(monkeypatch):
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(billing.settings, "stripe_webhook_secret", "whsec_123")
    db = _Db()
    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": "user-1",
                "customer": "cus_123",
                "subscription": "sub_123",
                "metadata": {},
            }
        },
    }
    subscription = {
        "id": "sub_123",
        "customer": "cus_123",
        "status": "active",
        "current_period_end": 1783555200,
        "trial_end": None,
        "cancel_at_period_end": False,
        "metadata": {},
        "items": {"data": [{"price": {"id": "price_mirra_pro"}}]},
    }
    monkeypatch.setattr(billing.stripe.Webhook, "construct_event", lambda *_args, **_kwargs: event)
    monkeypatch.setattr(billing.stripe.Subscription, "retrieve", lambda *_args, **_kwargs: subscription)

    r = _client(db).post("/billing/webhook", content=b"{}", headers={"Stripe-Signature": "sig"})

    assert r.status_code == 200
    assert db.billing["user-1"]["status"] == "active"
    assert db.billing["user-1"]["stripe_subscription_id"] == "sub_123"


def test_webhook_ignores_stale_out_of_order_event(monkeypatch):
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "sk_test_123")
    monkeypatch.setattr(billing.settings, "stripe_webhook_secret", "whsec_123")
    db = _Db(
        billing_row={
            "user_id": "user-1",
            "stripe_customer_id": "cus_123",
            "stripe_subscription_id": "sub_123",
            "status": "active",
            "updated_at": "2026-08-01T00:00:00+00:00",
        }
    )
    event = {
        "type": "customer.subscription.updated",
        "created": 1735689600,  # 2025-01-01 — older than the already-applied event above
        "data": {
            "object": {
                "id": "sub_123",
                "customer": "cus_123",
                "status": "canceled",
                "metadata": {"user_id": "user-1"},
                "items": {"data": []},
            }
        },
    }
    monkeypatch.setattr(billing.stripe.Webhook, "construct_event", lambda *_args, **_kwargs: event)

    r = _client(db).post("/billing/webhook", content=b"{}", headers={"Stripe-Signature": "sig"})

    assert r.status_code == 200
    assert db.billing["user-1"]["status"] == "active"  # stale redelivery did not revert live state


def test_pro_user_can_create_session_even_at_free_cap(monkeypatch):
    db = _Db(
        used=5,
        billing_row={
            "user_id": "user-1",
            "stripe_customer_id": "cus_123",
            "stripe_subscription_id": "sub_123",
            "status": "active",
        },
    )
    monkeypatch.setattr(
        "app.main.coordinator.run",
        lambda _audio, **_kwargs: {
            "observation": "You made space.",
            "pattern_to_reduce": "Rushing.",
            "thing_to_try_next": "Pause once.",
            "stats": {
                "talk_listen_ratio": 0.5,
                "question_count": 2,
                "interruption_count": 0,
                "session_duration_minutes": 1.0,
                "user_speech_duration_minutes": 0.5,
                "estimated_wpm": 120.0,
            },
            "transcript": "hello",
        },
    )

    r = _client(db).post(
        "/sessions",
        files={"audio": ("test.wav", BytesIO(b"RIFF....WAVE"), "audio/wav")},
    )

    assert r.status_code == 200
    assert r.json()["debrief"]["observation"] == "You made space."
    assert len(db.debriefs) == 1
