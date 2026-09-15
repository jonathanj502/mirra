from collections import deque
from threading import Lock
from time import monotonic

from fastapi import HTTPException

_requests: dict[str, deque] = {}
_lock = Lock()


def check_reflect_limit(user_id: str):
    # ponytail: per-process limit for a single-worker launch; move to shared storage before scaling workers.
    now = monotonic()
    with _lock:
        for key in list(_requests):
            if not _requests[key] or _requests[key][-1] <= now - 3600:
                del _requests[key]
        if user_id not in _requests and len(_requests) >= 10000:
            raise HTTPException(503, 'Reflect is busy. Please try again later.')
        requests = _requests.setdefault(user_id, deque())
        while requests and requests[0] <= now - 3600:
            requests.popleft()
        if len(requests) >= 60:
            raise HTTPException(429, 'Reflect allows 60 messages per hour. Please try again later.', headers={'Retry-After': '60'})
        requests.append(now)
