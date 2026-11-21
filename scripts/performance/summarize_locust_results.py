#!/usr/bin/env python3
"""Print a concise terminal summary from a Locust result JSON file.

Supports the normalized ChauatGo schema and common Locust JSON aliases. The
current normalized artifact contains requests, failures, p95 and p99. RPS,
average, p50 and max are shown when present or when duration is supplied.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


MISSING = "N/A"


def parse_duration(value: str | float | int | None) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value) if float(value) > 0 else None
    text = str(value).strip().lower()
    try:
        number = float(text)
    except ValueError:
        match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(ms|s|m|h)", text)
        if not match:
            return None
        number = float(match.group(1))
        text = match.group(2)
    if text == "ms":
        return number / 1000
    if text == "m":
        return number * 60
    if text == "h":
        return number * 3600
    return number if number > 0 else None


def first_value(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value is not None and value != "":
            return value
    return None


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def integer(value: Any) -> int | None:
    parsed = number(value)
    return int(parsed) if parsed is not None else None


def choose_row(document: dict[str, Any]) -> dict[str, Any]:
    stats = document.get("stats")
    if isinstance(stats, dict):
        return stats
    if isinstance(stats, list):
        rows = [row for row in stats if isinstance(row, dict)]
        for row in rows:
            name = str(row.get("name", "")).lower()
            if name in {"aggregated", "aggregate", "total", ""}:
                return row
        if rows:
            return rows[0]
    return document


def get_metric(row: dict[str, Any], document: dict[str, Any], *keys: str) -> Any:
    row_value = first_value(row, *keys)
    if row_value is not None:
        return row_value
    return first_value(document, *keys)


def format_number(value: float | int | None, decimals: int = 2) -> str:
    if value is None:
        return MISSING
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.{decimals}f}"


def build_report(document: dict[str, Any], duration_override: float | None) -> dict[str, Any]:
    row = choose_row(document)
    requests = integer(get_metric(row, document, "num_requests", "requests", "total_requests"))
    failures = integer(get_metric(row, document, "num_failures", "failures", "failed_requests"))
    duration = duration_override
    if duration is None:
        duration = parse_duration(first_value(row, "duration_seconds", "duration_s", "run_time"))
    if duration is None:
        duration = parse_duration(first_value(document, "duration_seconds", "duration_s", "run_time"))

    rps = number(get_metric(row, document, "requests_per_second", "rps", "total_rps"))
    if rps is None and requests is not None and duration:
        rps = requests / duration

    failure_rate = None
    if requests is not None and requests > 0 and failures is not None:
        failure_rate = failures / requests * 100

    return {
        "requests": requests,
        "failures": failures,
        "failure_rate": failure_rate,
        "duration": duration,
        "rps": rps,
        "avg": number(get_metric(row, document, "avg_response_time", "response_time_avg", "average_response_time")),
        "p50": number(get_metric(row, document, "response_time_percentile_0.50", "p50", "p50_ms")),
        "p95": number(get_metric(row, document, "response_time_percentile_0.95", "p95", "p95_ms")),
        "p99": number(get_metric(row, document, "response_time_percentile_0.99", "p99", "p99_ms")),
        "max": number(get_metric(row, document, "max_response_time", "response_time_max", "max_ms")),
    }


def print_report(
    path: Path,
    metrics: dict[str, Any],
    max_failure_rate: float,
    max_p95_ms: float,
    passed: bool,
) -> None:
    print(f"Locust report: {path}")
    print("=" * 48)
    print(f"Requests:       {format_number(metrics['requests'], 0)}")
    print(f"Failures:       {format_number(metrics['failures'], 0)}")
    print(f"Failure rate:   {format_number(metrics['failure_rate'])}%")
    print(f"Duration:       {format_number(metrics['duration'])} s")
    print(f"RPS:            {format_number(metrics['rps'])}")
    print("Response time (ms):")
    print(f"  Average:      {format_number(metrics['avg'])}")
    print(f"  P50:          {format_number(metrics['p50'])}")
    print(f"  P95:          {format_number(metrics['p95'])}")
    print(f"  P99:          {format_number(metrics['p99'])}")
    print(f"  Maximum:      {format_number(metrics['max'])}")
    print("Thresholds:")
    print(
        f"  Failure rate: {format_number(metrics['failure_rate'])}% "
        f"(max {format_number(max_failure_rate)}%)"
    )
    print(
        f"  P95:          {format_number(metrics['p95'])} ms "
        f"(max {format_number(max_p95_ms)} ms)"
    )
    print(f"Result:         {'PASS' if passed else 'FAIL'}")


def report_text(path: Path, metrics: dict[str, Any], max_failure_rate: float, max_p95_ms: float, passed: bool) -> str:
    status = "PASS" if passed else "FAIL"
    return "\n".join(
        [
            f"Locust Threshold: {status}",
            f"Report: {path}",
            f"Requests: {format_number(metrics['requests'], 0)}",
            f"Failures: {format_number(metrics['failures'], 0)}",
            f"Failure rate: {format_number(metrics['failure_rate'])}% (max {format_number(max_failure_rate)}%)",
            f"RPS: {format_number(metrics['rps'])}",
            f"P95 latency: {format_number(metrics['p95'])} ms (max {format_number(max_p95_ms)} ms)",
            f"P99 latency: {format_number(metrics['p99'])} ms",
        ]
    )


def post_json(url: str, payload: dict[str, Any]) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"HTTP {response.status}")


def send_notifications(
    path: Path,
    metrics: dict[str, Any],
    max_failure_rate: float,
    max_p95_ms: float,
    passed: bool,
    mode: str,
    slack_env: str,
    teams_env: str,
) -> bool:
    if mode == "none":
        return True

    status = "PASSED" if passed else "FAILED"
    text = report_text(path, metrics, max_failure_rate, max_p95_ms, passed)
    targets: list[tuple[str, str, dict[str, Any]]] = []
    slack_url = os.getenv(slack_env, "")
    teams_url = os.getenv(teams_env, "")

    if mode in {"auto", "slack", "both"} and slack_url:
        targets.append(("Slack", slack_url, {"text": text}))
    if mode in {"auto", "teams", "both"} and teams_url:
        targets.append(
            (
                "Microsoft Teams",
                teams_url,
                {
                    "@type": "MessageCard",
                    "@context": "https://schema.org/extensions",
                    "summary": f"Locust Threshold: {status}",
                    "themeColor": "00A86B" if passed else "D93F0B",
                    "title": f"Locust Threshold — {status}",
                    "text": text.replace("\n", "<br>"),
                },
            )
        )

    if mode in {"slack", "teams", "both"} and not targets:
        print("Notification skipped: requested webhook environment variable is empty.", file=sys.stderr)
        return False
    if mode == "auto" and not targets:
        print("Notification skipped: SLACK_WEBHOOK_URL and TEAMS_WEBHOOK_URL are not configured.")
        return True

    notification_ok = True
    for channel, url, payload in targets:
        try:
            post_json(url, payload)
            print(f"Notification sent: {channel}")
        except (OSError, urllib.error.URLError, RuntimeError) as exc:
            print(f"Notification failed: {channel}: {exc}", file=sys.stderr)
            notification_ok = False
    return notification_ok


def send_error_notifications(message: str, mode: str, slack_env: str, teams_env: str) -> bool:
    """Send an ERROR status when the result file cannot be evaluated."""
    if mode == "none":
        return True

    text = f"Locust Performance: ERROR\nError: {message}"
    targets: list[tuple[str, str, dict[str, Any]]] = []
    slack_url = os.getenv(slack_env, "")
    teams_url = os.getenv(teams_env, "")
    if mode in {"auto", "slack", "both"} and slack_url:
        targets.append(("Slack", slack_url, {"text": text}))
    if mode in {"auto", "teams", "both"} and teams_url:
        targets.append(
            (
                "Microsoft Teams",
                teams_url,
                {
                    "@type": "MessageCard",
                    "@context": "https://schema.org/extensions",
                    "summary": "Locust Performance: ERROR",
                    "themeColor": "D93F0B",
                    "title": "Locust Performance — ERROR",
                    "text": text.replace("\n", "<br>"),
                },
            )
        )
    if not targets:
        if mode == "auto":
            print("Error notification skipped: no Slack/Teams webhook is configured.")
            return True
        print("Error notification skipped: requested webhook environment variable is empty.", file=sys.stderr)
        return False

    notification_ok = True
    for channel, url, payload in targets:
        try:
            post_json(url, payload)
            print(f"Error notification sent: {channel}")
        except (OSError, urllib.error.URLError, RuntimeError) as exc:
            print(f"Error notification failed: {channel}: {exc}", file=sys.stderr)
            notification_ok = False
    return notification_ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, nargs="?", help="Path to locust-results.json")
    parser.add_argument(
        "--duration-seconds",
        type=float,
        help="Run duration used to calculate RPS when JSON has no duration/RPS",
    )
    parser.add_argument(
        "--max-failure-rate",
        type=float,
        default=1.0,
        help="Maximum allowed failure rate in percent (default: 1.0)",
    )
    parser.add_argument(
        "--max-p95-ms",
        type=float,
        default=200.0,
        help="Maximum allowed p95 response time in milliseconds (default: 200)",
    )
    parser.add_argument(
        "--notify",
        choices=("auto", "none", "slack", "teams", "both"),
        default="auto",
        help="Notification mode; auto sends to configured Slack/Teams webhooks (default: auto)",
    )
    parser.add_argument(
        "--slack-webhook-env",
        default="SLACK_WEBHOOK_URL",
        help="Environment variable containing the Slack webhook URL",
    )
    parser.add_argument(
        "--teams-webhook-env",
        default="TEAMS_WEBHOOK_URL",
        help="Environment variable containing the Teams webhook URL",
    )
    parser.add_argument(
        "--error-message",
        help="Send an ERROR notification without reading a result file",
    )
    args = parser.parse_args()

    if args.max_failure_rate < 0 or args.max_p95_ms < 0:
        print("Error: thresholds must be non-negative", file=sys.stderr)
        return 2

    if args.error_message:
        send_error_notifications(
            args.error_message,
            args.notify,
            args.slack_webhook_env,
            args.teams_webhook_env,
        )
        return 2

    if args.input is None:
        print("Error: input path is required", file=sys.stderr)
        return 2
    if not args.input.is_file():
        message = f"file not found: {args.input}"
        print(f"Error: {message}", file=sys.stderr)
        send_error_notifications(message, args.notify, args.slack_webhook_env, args.teams_webhook_env)
        return 2
    try:
        document = json.loads(args.input.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        message = f"cannot read JSON: {exc}"
        print(f"Error: {message}", file=sys.stderr)
        send_error_notifications(message, args.notify, args.slack_webhook_env, args.teams_webhook_env)
        return 2
    if not isinstance(document, dict):
        message = "expected a JSON object at the document root"
        print(f"Error: {message}", file=sys.stderr)
        send_error_notifications(message, args.notify, args.slack_webhook_env, args.teams_webhook_env)
        return 2

    metrics = build_report(document, args.duration_seconds)
    failure_rate_ok = (
        metrics["failure_rate"] is not None
        and metrics["failure_rate"] <= args.max_failure_rate
    )
    p95_ok = metrics["p95"] is not None and metrics["p95"] <= args.max_p95_ms
    passed = failure_rate_ok and p95_ok
    print_report(args.input, metrics, args.max_failure_rate, args.max_p95_ms, passed)
    if not failure_rate_ok:
        print(
            "Threshold failure: Failure Rate is missing or exceeds the allowed maximum.",
            file=sys.stderr,
        )
    if not p95_ok:
        print(
            "Threshold failure: P95 is missing or exceeds the allowed maximum.",
            file=sys.stderr,
        )
    notification_ok = send_notifications(
        args.input,
        metrics,
        args.max_failure_rate,
        args.max_p95_ms,
        passed,
        args.notify,
        args.slack_webhook_env,
        args.teams_webhook_env,
    )
    if not notification_ok and passed:
        return 3
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
