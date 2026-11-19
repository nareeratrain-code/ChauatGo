"""HTTP performance test for the ChauatGo rider web entry point.

This test measures HTTP delivery and availability only. Keep the existing
Playwright performance/stress tests for browser rendering and DOM behavior.

Example:
    pip install locust
    LOCUST_TARGET_URL=http://127.0.0.1:4173 \
    LOCUST_USERS=20 LOCUST_SPAWN_RATE=5 LOCUST_RUN_TIME=30s \
    locust -f scripts/performance/locustfile.py --headless

Environment variables:
    LOCUST_TARGET_URL     Base URL; default http://127.0.0.1:4173
    LOCUST_TARGET_PATH    Path to request; default /rider.html?qa=job-filter
    LOCUST_USERS           Concurrent users; default 10
    LOCUST_SPAWN_RATE      Users started per second; default 2
    LOCUST_RUN_TIME        Headless duration; default 30s
    LOCUST_MAX_FAILURES    Maximum failed requests; default 0
    LOCUST_MAX_P95_MS      Maximum p95 latency in milliseconds; default 2000
"""

import os
from typing import Any

from locust import HttpUser, between, events, task


TARGET_PATH = os.getenv("LOCUST_TARGET_PATH", "/rider.html?qa=job-filter")
TARGET_URL = os.getenv("LOCUST_TARGET_URL", "http://127.0.0.1:4173")
MAX_FAILURES = int(os.getenv("LOCUST_MAX_FAILURES", "0"))
MAX_P95_MS = float(os.getenv("LOCUST_MAX_P95_MS", "2000"))


class RiderEntryPointUser(HttpUser):
    """A lightweight user that repeatedly loads the rider entry point."""

    host = TARGET_URL
    wait_time = between(1, 3)

    @task(8)
    def load_rider_entry_point(self) -> None:
        with self.client.get(
            TARGET_PATH,
            name="GET rider entry point",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"unexpected HTTP status {response.status_code}")
                return

            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                response.failure(f"unexpected content type: {content_type}")
                return

            if "<html" not in response.text.lower():
                response.failure("response does not contain an HTML document")

    @task(2)
    def load_rider_static_asset(self) -> None:
        """Exercise one small asset request, similar to a browser's first load."""

        self.client.get("/rider.css", name="GET rider stylesheet")


@events.test_stop.add_listener
def enforce_performance_budget(environment: Any, **kwargs: Any) -> None:
    """Convert failed requests or an excessive p95 into a CI failure."""

    stats = environment.stats.total
    p95_ms = stats.get_response_time_percentile(0.95) or 0
    failure_count = stats.num_failures

    print(
        "[locust] requests=%s failures=%s p95_ms=%s max_p95_ms=%s"
        % (stats.num_requests, failure_count, p95_ms, MAX_P95_MS)
    )

    if failure_count > MAX_FAILURES or p95_ms > MAX_P95_MS:
        environment.process_exit_code = 1
        print("[locust] performance budget: FAILED")
    else:
        print("[locust] performance budget: PASSED")
