"""HTTP performance test for the ChauatGo rider web entry point.

This test measures HTTP delivery and availability only. It models several
rider traffic patterns; keep the existing Playwright performance/stress tests
for browser rendering and DOM behavior.

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
    LOCUST_NORMAL_WEIGHT   Weight for normal browsing users; default 6
    LOCUST_FILTER_WEIGHT   Weight for filter-heavy users; default 3
    LOCUST_ASSET_WEIGHT    Weight for asset-only users; default 1
    LOCUST_MAX_FAILURES    Maximum failed requests; default 0
    LOCUST_MAX_P95_MS      Maximum p95 latency in milliseconds; default 2000
"""

import os
import random
from typing import Any

from locust import HttpUser, between, events, task


TARGET_PATH = os.getenv("LOCUST_TARGET_PATH", "/rider.html?qa=job-filter")
TARGET_URL = os.getenv("LOCUST_TARGET_URL", "http://127.0.0.1:4173")
MAX_FAILURES = int(os.getenv("LOCUST_MAX_FAILURES", "0"))
MAX_P95_MS = float(os.getenv("LOCUST_MAX_P95_MS", "2000"))
NORMAL_WEIGHT = int(os.getenv("LOCUST_NORMAL_WEIGHT", "6"))
FILTER_WEIGHT = int(os.getenv("LOCUST_FILTER_WEIGHT", "3"))
ASSET_WEIGHT = int(os.getenv("LOCUST_ASSET_WEIGHT", "1"))


def check_success(response: Any, expected_content_type: str | None = None) -> None:
    """Mark an HTTP response as failed with a useful reason."""

    if response.status_code != 200:
        response.failure(f"unexpected HTTP status {response.status_code}")
        return

    if expected_content_type:
        content_type = response.headers.get("content-type", "")
        if expected_content_type not in content_type:
            response.failure(f"unexpected content type: {content_type}")


class BaseRiderUser(HttpUser):
    """Shared configuration for the different rider traffic profiles."""

    abstract = True
    host = TARGET_URL

    def get_html(self, path: str, name: str) -> None:
        with self.client.get(path, name=name, catch_response=True) as response:
            check_success(response, "text/html")
            if response.status_code == 200 and "<html" not in response.text.lower():
                response.failure("response does not contain an HTML document")

    def get_asset(self, path: str, name: str) -> None:
        with self.client.get(path, name=name, catch_response=True) as response:
            check_success(response)


class RiderEntryPointUser(BaseRiderUser):
    """Normal rider: opens the dashboard and occasionally loads an asset."""

    weight = NORMAL_WEIGHT
    wait_time = between(1, 3)

    @task(8)
    def load_rider_entry_point(self) -> None:
        self.get_html(TARGET_PATH, "GET rider entry point")

    @task(2)
    def load_rider_static_asset(self) -> None:
        self.get_asset("/rider.css", "GET rider stylesheet")


class RiderFilterUser(BaseRiderUser):
    """Filter-heavy rider: rapidly switches between food, express, and all."""

    weight = FILTER_WEIGHT
    wait_time = between(0.5, 1.5)

    @task
    def switch_job_filter(self) -> None:
        filter_name = random.choice(("food", "express", "all"))
        separator = "&" if "?" in TARGET_PATH else "?"
        path = f"{TARGET_PATH}{separator}filter={filter_name}"
        self.get_html(path, f"GET rider filter {filter_name}")

    @task(2)
    def refresh_job_list(self) -> None:
        self.get_html(TARGET_PATH, "GET rider job list refresh")


class RiderAssetUser(BaseRiderUser):
    """Asset-heavy rider: models a burst of first-page static requests."""

    weight = ASSET_WEIGHT
    wait_time = between(0.2, 0.8)

    @task(5)
    def load_stylesheet(self) -> None:
        self.get_asset("/rider.css", "GET rider stylesheet")

    @task(2)
    def load_brand_stylesheet(self) -> None:
        self.get_asset("/brand-ui.css", "GET brand stylesheet")

    @task
    def load_entry_point(self) -> None:
        self.get_html(TARGET_PATH, "GET rider entry point from asset profile")


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
