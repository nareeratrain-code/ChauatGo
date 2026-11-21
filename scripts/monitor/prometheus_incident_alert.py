#!/usr/bin/env python3
"""Monitor Prometheus latency/error metrics and notify Slack on incident state changes.

The monitor uses Prometheus instant queries. It keeps a small JSON state file so
short-lived spikes do not immediately page the team and repeated cron runs do
not spam Slack.

Default PromQL assumes standard HTTP metrics:
  - http_request_duration_seconds_bucket
  - http_requests_total

Override --p95-query and --failure-rate-query for the application's metric names.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_P95_QUERY = (
    'histogram_quantile(0.95, '
    'sum by (le) (rate(http_request_duration_seconds_bucket{job="chauatgo"}[5m]))) * 1000'
)
DEFAULT_FAILURE_RATE_QUERY = (
    '100 * sum(rate(http_requests_total{job="chauatgo",status=~"5.."}[5m])) '
    '/ sum(rate(http_requests_total{job="chauatgo"}[5m]))'
)


@dataclass(frozen=True)
class Metrics:
    p95_ms: float
    failure_rate_pct: float


class MonitorError(Exception):
    """Raised for configuration, Prometheus, or response errors."""


def finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise MonitorError(f"{label} is not numeric: {value!r}") from exc
    if not math.isfinite(number):
        raise MonitorError(f"{label} is not finite: {value!r}")
    return number


def http_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=data,
        headers=headers or {},
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status < 200 or response.status >= 300:
                raise MonitorError(f"HTTP {response.status} from {url}")
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise MonitorError(f"HTTP {exc.code} from {url}") from exc
    except urllib.error.URLError as exc:
        raise MonitorError(f"request failed for {url}: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise MonitorError(f"invalid JSON from {url}: {exc}") from exc

    if not isinstance(payload, dict):
        raise MonitorError(f"unexpected JSON root from {url}")
    return payload


def query_prometheus(base_url: str, query: str) -> float:
    url = f"{base_url.rstrip('/')}/api/v1/query?{urllib.parse.urlencode({'query': query})}"
    payload = http_json(url)
    if payload.get("status") != "success":
        raise MonitorError(f"Prometheus query failed: {payload.get('error', 'unknown error')}")

    data = payload.get("data")
    if not isinstance(data, dict) or data.get("resultType") != "vector":
        raise MonitorError("Prometheus response is not an instant vector")
    results = data.get("result")
    if not isinstance(results, list) or not results:
        raise MonitorError("Prometheus query returned no data")

    first = results[0]
    if not isinstance(first, dict) or not isinstance(first.get("value"), list) or len(first["value"]) < 2:
        raise MonitorError("Prometheus result does not contain a value")
    return finite_number(first["value"][1], "Prometheus metric")


def read_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"status": "healthy", "breach_count": 0, "error_count": 0}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MonitorError(f"cannot read state file {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise MonitorError(f"state file {path} must contain a JSON object")
    return payload


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def build_slack_text(
    status: str,
    metrics: Metrics | None,
    args: argparse.Namespace,
    detail: str | None = None,
) -> str:
    lines = [
        f"{args.service_name} Incident Monitor: {status}",
        f"Environment: {args.environment}",
        f"Prometheus: {args.prometheus_url}",
    ]
    if metrics is not None:
        lines.extend(
            [
                f"P95 latency: {metrics.p95_ms:.2f} ms (max {args.max_p95_ms:.2f} ms)",
                f"Failure rate: {metrics.failure_rate_pct:.2f}% (max {args.max_failure_rate:.2f}%)",
            ]
        )
    if detail:
        lines.append(f"Detail: {detail}")
    if args.dashboard_url:
        lines.append(f"Dashboard: {args.dashboard_url}")
    if args.runbook_url:
        lines.append(f"Runbook: {args.runbook_url}")
    lines.append(f"Checked at: {datetime.now(timezone.utc).isoformat()}")
    return "\n".join(lines)


def send_slack(text: str, webhook_url: str) -> None:
    payload = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        webhook_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status < 200 or response.status >= 300:
                raise MonitorError(f"Slack HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        raise MonitorError(f"Slack HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise MonitorError(f"Slack request failed: {exc.reason}") from exc


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prometheus-url", default=os.getenv("PROMETHEUS_URL", "http://127.0.0.1:9090"))
    parser.add_argument("--slack-webhook-env", default="SLACK_WEBHOOK_URL")
    parser.add_argument("--state-file", type=Path, default=Path(os.getenv("INCIDENT_STATE_FILE", "/tmp/chauatgo-prometheus-incident-state.json")))
    parser.add_argument("--p95-query", default=os.getenv("P95_QUERY", DEFAULT_P95_QUERY))
    parser.add_argument("--failure-rate-query", default=os.getenv("FAILURE_RATE_QUERY", DEFAULT_FAILURE_RATE_QUERY))
    parser.add_argument("--max-p95-ms", type=float, default=float(os.getenv("MAX_P95_MS", "200")))
    parser.add_argument("--max-failure-rate", type=float, default=float(os.getenv("MAX_FAILURE_RATE", "1")))
    parser.add_argument("--consecutive-breaches", type=int, default=int(os.getenv("CONSECUTIVE_BREACHES", "2")))
    parser.add_argument("--service-name", default=os.getenv("SERVICE_NAME", "ChauatGo"))
    parser.add_argument("--environment", default=os.getenv("ENVIRONMENT", "production"))
    parser.add_argument("--dashboard-url", default=os.getenv("DASHBOARD_URL", ""))
    parser.add_argument("--runbook-url", default=os.getenv("RUNBOOK_URL", ""))
    parser.add_argument("--dry-run", action="store_true", help="Evaluate and print; never send Slack or write state")
    parser.add_argument("--notify-always", action="store_true", help="Send the current status even when it has not changed")
    args = parser.parse_args(argv)
    if args.max_p95_ms < 0 or args.max_failure_rate < 0:
        parser.error("thresholds must be non-negative")
    if args.consecutive_breaches < 1:
        parser.error("--consecutive-breaches must be at least 1")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    webhook_url = os.getenv(args.slack_webhook_env, "")
    state = read_state(args.state_file) if not args.dry_run else {"status": "healthy", "breach_count": 0, "error_count": 0}

    try:
        metrics = Metrics(
            p95_ms=query_prometheus(args.prometheus_url, args.p95_query),
            failure_rate_pct=query_prometheus(args.prometheus_url, args.failure_rate_query),
        )
        p95_breached = metrics.p95_ms > args.max_p95_ms
        failure_breached = metrics.failure_rate_pct > args.max_failure_rate
        breached = p95_breached or failure_breached
        breach_count = int(state.get("breach_count", 0)) + 1 if breached else 0
        previous_status = state.get("status", "healthy")
        status = "incident" if breached and breach_count >= args.consecutive_breaches else previous_status
        if not breached:
            status = "healthy"

        detail_parts = []
        if p95_breached:
            detail_parts.append("P95 exceeded threshold")
        if failure_breached:
            detail_parts.append("Failure Rate exceeded threshold")
        detail = "; ".join(detail_parts) or None
        print(
            f"P95={metrics.p95_ms:.2f} ms, Failure Rate={metrics.failure_rate_pct:.2f}%, "
            f"breach_count={breach_count}, status={status}"
        )

        should_notify = args.notify_always or status != previous_status
        if status == "incident" and previous_status == "incident":
            should_notify = args.notify_always
        if status == "healthy" and previous_status in {"incident", "error"}:
            notification_status = "RECOVERED"
        elif status == "incident" and previous_status != "incident":
            notification_status = "INCIDENT"
        else:
            notification_status = "HEALTHY"

        if should_notify and not args.dry_run:
            if not webhook_url:
                raise MonitorError(f"{args.slack_webhook_env} is not configured")
            send_slack(build_slack_text(notification_status, metrics, args, detail), webhook_url)
            print(f"Slack notification sent: {notification_status}")
        elif should_notify:
            print(f"Dry run notification: {notification_status}")

        if not args.dry_run:
            write_state(
                args.state_file,
                {
                    "status": status,
                    "breach_count": breach_count,
                    "error_count": 0,
                    "last_metrics": metrics.__dict__,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        return 1 if status == "incident" else 0

    except MonitorError as exc:
        message = str(exc)
        print(f"Monitor error: {message}", file=sys.stderr)
        previous_status = state.get("status", "healthy")
        error_count = int(state.get("error_count", 0)) + 1
        if not args.dry_run:
            if webhook_url and (previous_status != "error" or args.notify_always):
                try:
                    send_slack(build_slack_text("ERROR", None, args, message), webhook_url)
                    print("Slack notification sent: ERROR")
                except MonitorError as notify_exc:
                    print(f"Error notification failed: {notify_exc}", file=sys.stderr)
                    return 3
            write_state(
                args.state_file,
                {
                    "status": "error",
                    "breach_count": int(state.get("breach_count", 0)),
                    "error_count": error_count,
                    "last_error": message,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        else:
            print("Dry run error notification: ERROR")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
