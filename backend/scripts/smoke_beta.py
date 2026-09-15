"""Live beta check using synthetic audio and a temporary account; prints no content or tokens.

From backend/: python -m scripts.smoke_beta --url https://HOST --audio /path/to/synthetic.m4a
Uses backend/.env only to clean up the account created by this run.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import secrets
import time
from uuid import uuid4

import httpx
from jose import jwt

from app.config import settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--audio", required=True, type=Path)
    args = parser.parse_args()
    audio = args.audio.read_bytes()
    assert args.audio.suffix.lower() == ".m4a", "Use synthetic M4A audio to exercise the iOS codec"
    assert 0 < len(audio) <= 25 * 1024 * 1024
    username, password = f"beta_{uuid4().hex[:16]}", secrets.token_urlsafe(24)
    user_id = None
    with httpx.Client(base_url=args.url.rstrip("/"), timeout=600) as client:
        def call(method, path, **kwargs):
            print(f"CHECK {method} {path}", flush=True)
            response = client.request(method, path, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else None

        try:
            assert call("GET", "/health")["status"] == "ok"
            assert call("GET", "/auth/status")["username_password_ready"]
            session = call("POST", "/auth/username/sign-up", json={"username": username, "password": password})
            # Only clean up in the configured project, never infer a privileged destination from a token.
            claims = jwt.get_unverified_claims(session["access_token"])
            assert claims["iss"] == f"{settings.supabase_url.rstrip('/')}/auth/v1", "Backend/Supabase project mismatch"
            user_id = session["user"]["id"]
            session = call("POST", "/auth/username/sign-in", json={"username": username, "password": password})
            assert session["user"]["id"] == user_id
            client.headers["Authorization"] = f"Bearer {session['access_token']}"
            assert call("GET", "/debriefs") == []
            before = call("GET", "/usage")["used_this_month"]
            print("PASS signup, sign-in, JWT verification, empty history, usage", flush=True)

            recording_id = str(uuid4())
            metadata = {"recording_id": recording_id, "title": "Synthetic beta smoke test",
                        "started_at": datetime.now(timezone.utc).isoformat()}
            start = time.monotonic()
            result = call("POST", "/sessions", data=metadata, files={"audio": ("synthetic.m4a", audio, "audio/mp4")})
            debrief = result["debrief"]
            for field in ["observation", "pattern_to_reduce", "thing_to_try_next"]:
                assert debrief[field].strip(), field
            assert debrief["stats"]["session_duration_minutes"] > 0
            assert debrief["stats"]["metadata"]["diarization"]["speaker_count"] >= 1, "No speech transcribed"
            assert result["used_this_month"] == before + 1
            print(f"PASS M4A decode, speech transcription, coaching, persistence ({time.monotonic() - start:.1f}s)", flush=True)

            replay = call("POST", "/sessions", data=metadata, files={"audio": ("synthetic.m4a", audio, "audio/mp4")})
            assert replay["debrief"]["id"] == debrief["id"]
            assert replay["used_this_month"] == before + 1
            assert call("GET", f"/debriefs/{debrief['id']}")["observation"] == debrief["observation"]
            assert len(call("GET", "/debriefs")) == 1
            print("PASS retry returns the same debrief, one usage charge, history/detail reads", flush=True)

            reflection = call("POST", "/reflect", json={"prompt": "What is one thing to try in my next conversation?",
                                                       "conversation_id": debrief["id"], "messages": []})
            assert reflection["reply"].strip() and reflection["used_model"], "Reflect used a fallback"
            print("PASS Reflect model reply", flush=True)
            call("DELETE", f"/debriefs/{debrief['id']}")
            assert call("GET", "/debriefs") == []
            assert call("GET", "/usage")["used_this_month"] == before + 1
            print("PASS conversation deletion preserves usage", flush=True)
        finally:
            if user_id:
                response = httpx.delete(
                    f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
                    headers={"apikey": settings.supabase_service_role_key,
                             "Authorization": f"Bearer {settings.supabase_service_role_key}"}, timeout=30,
                )
                response.raise_for_status()
                print("PASS temporary test account cleanup", flush=True)


if __name__ == "__main__":
    main()
