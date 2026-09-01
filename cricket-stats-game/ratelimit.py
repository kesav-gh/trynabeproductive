"""
ratelimit.py

A minimal, in-memory, per-process rate limiter for the auth endpoints
(login, register) -- fixed-window counting per client IP, kept in a
plain dict guarded by a lock. This deliberately does NOT reach for
Redis or any other shared store: this app runs as a single local Flask
process, and a limiter that only needs to survive within that one
process is enough to blunt an obvious brute-force script without adding
new infrastructure.

Real limitations, worth knowing before this goes anywhere near a real
deployment:
  - Resets completely on every process restart.
  - Does not share state across multiple worker processes -- running
    behind a multi-process WSGI server (`gunicorn -w 4`, for example)
    means each worker enforces its own separate counter, so the
    EFFECTIVE limit becomes (this limit) x (worker count).
  - Keyed by request.remote_addr, which is only correct if requests
    reach this process directly. Behind a reverse proxy that doesn't
    forward the real client IP, every request would appear to come from
    the proxy's own address and share one limit -- one legitimate user
    behind that proxy could lock out everyone else behind it.
  - An attacker who can vary their source IP (a botnet, most VPNs, many
    residential proxy services) is barely slowed down by a per-IP limit
    alone.

This is good enough to stop a careless script hammering one endpoint
from one machine. It is not a substitute for a real distributed rate
limiter before this is ever exposed to the internet.
"""

import threading
import time
from collections import defaultdict, deque

_lock = threading.Lock()
_attempts = defaultdict(deque)  # key -> deque of attempt timestamps, oldest first


def check(key, limit, window_seconds):
    """
    True if `key` is still under `limit` attempts within the trailing
    `window_seconds`, and records this attempt. False if the limit is
    already reached -- in that case nothing is recorded, so a client
    that backs off and waits doesn't "use up" a slot just by asking.
    """
    now = time.time()
    with _lock:
        bucket = _attempts[key]
        while bucket and now - bucket[0] > window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


def reset():
    """Test-only: clear every recorded attempt, so one test's rate-limit
    hits don't bleed into the next test run in the same process."""
    with _lock:
        _attempts.clear()
