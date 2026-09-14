from collections import deque
from threading import Lock
from time import monotonic

from fastapi import HTTPException

_requests: dict[str, deque] = {}
_lock = Lock()


def check_reflect_limit(user_id: str):
    check_request_limit(user_id, 'Reflect', 60)


def check_request_limit(user_id: str, operation: str, maximum: int):
    # ponytail: per-process limit for a single-worker launch; move to shared storage before scaling workers.
    now = monotonic()
    user_id = f'{operation}:{user_id}'
    with _lock:
        for key in list(_requests):
            if not _requests[key] or _requests[key][-1] <= now - 3600:
                del _requests[key]
        if user_id not in _requests and len(_requests) >= 10000:
            raise HTTPException(503, 'Mirra is busy. Please try again later.')
        requests = _requests.setdefault(user_id, deque())
        while requests and requests[0] <= now - 3600:
            requests.popleft()
        if len(requests) >= maximum:
            raise HTTPException(429, f'{operation} allows {maximum} requests per hour. Please try again later.', headers={'Retry-After': '60'})
        requests.append(now)
