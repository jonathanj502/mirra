from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app, raise_server_exceptions=False)


def test_unhandled_exception_returns_json_with_cors_not_plaintext():
    app.add_api_route("/__boom", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    try:
        r = client.get("/__boom", headers={"Origin": "http://localhost:8081"})
    finally:
        app.router.routes = [route for route in app.router.routes if getattr(route, "path", None) != "/__boom"]

    assert r.status_code == 500
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"detail": "Internal server error"}
    # Regression check: ServerErrorMiddleware sits outside CORSMiddleware, so an
    # @app.exception_handler(Exception)-style fix would silently drop this header.
    assert r.headers.get("access-control-allow-origin") == "http://localhost:8081"
