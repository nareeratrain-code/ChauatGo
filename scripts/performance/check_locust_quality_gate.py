#!/usr/bin/env python3
"""Fail CI when Locust aggregate latency or failure budgets are exceeded.

Usage:
    python3 scripts/performance/check_locust_quality_gate.py \
      --input locust-results.json \
      --max-p95-ms 2000 \
      --max-failures 0

The parser accepts Locust JSON exports that use either an aggregate row named
"Aggregated"/"Total" or top-level total_* fields. It also writes GitHub
Actions outputs when GITHUB_OUTPUT is available.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any


P95_KEYS = (
    "response_time_percentile_0.95",
    "response_time_percentile_95",
    "p95_latency_ms",
    "p95",
    "total_response_time_percentile_0.95",
    "total_response_time_percentile_95",
    "total_p95_latency_ms",
    "total_p95",
)
FAILURE_KEYS = ("num_failures", "failures", "total_failures")
REQUEST_KEYS = ("num_requests", "requests", "total_requests")
AGGREGATE_NAMES = {"aggregated", "aggregate", "total", "all"}


class QualityGateError(ValueError):
    """Raised when the Locust result cannot be evaluated safely."""


def as_number(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise QualityGateError(f"{field} is not numeric: {value!r}") from exc
    if number < 0:
        raise QualityGateError(f"{field} cannot be negative: {number}")
    return number


def first_number(source: dict[str, Any], keys: tuple[str, ...], field: str) -> float | None:
    for key in keys:
        if key in source and source[key] is not None:
            return as_number(source[key], key)
    return None


def aggregate_row(data: Any) -> dict[str, Any]:
    """Return the aggregate Locust result from common JSON export shapes."""

    if not isinstance(data, dict):
        raise QualityGateError("Locust JSON root must be an object")

    stats = data.get("stats")
    if isinstance(stats, list):
        for row in stats:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name", row.get("method", ""))).strip().lower()
            if name in AGGREGATE_NAMES or row.get("aggregated") is True:
                return row

        # A single-row stats export is safe to evaluate as the aggregate.
        if len(stats) == 1 and isinstance(stats[0], dict):
            return stats[0]

    return data


def read_metrics(path: Path) -> tuple[float, float, float]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise QualityGateError(f"Locust result file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise QualityGateError(f"Invalid JSON in {path}: {exc}") from exc

    row = aggregate_row(data)
    p95 = first_number(row, P95_KEYS, "p95 latency")
    failures = first_number(row, FAILURE_KEYS, "failures")
    requests = first_number(row, REQUEST_KEYS, "requests")

    if p95 is None:
        raise QualityGateError(
            "Could not find aggregate p95 latency. Expected one of: "
            + ", ".join(P95_KEYS)
        )
    if failures is None:
        raise QualityGateError(
            "Could not find aggregate failure count. Expected one of: "
            + ", ".join(FAILURE_KEYS)
        )
    if requests is None:
        raise QualityGateError(
            "Could not find aggregate request count. Expected one of: "
            + ", ".join(REQUEST_KEYS)
        )

    return p95, failures, requests


def write_github_output(values: dict[str, Any]) -> None:
    output_path = os.getenv("GITHUB_OUTPUT")
    if not output_path:
        return
    with Path(output_path).open("a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Locust JSON result file")
    parser.add_argument(
        "--max-p95-ms",
        type=float,
        default=float(os.getenv("LOCUST_MAX_P95_MS", "2000")),
        help="Maximum aggregate p95 latency in milliseconds",
    )
    parser.add_argument(
        "--max-failures",
        type=float,
        default=float(os.getenv("LOCUST_MAX_FAILURES", "0")),
        help="Maximum aggregate failed requests",
    )
    parser.add_argument(
        "--min-requests",
        type=float,
        default=float(os.getenv("LOCUST_MIN_REQUESTS", "1")),
        help="Minimum aggregate requests required for a valid run",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for name, value in (
        ("max-p95-ms", args.max_p95_ms),
        ("max-failures", args.max_failures),
        ("min-requests", args.min_requests),
    ):
        if value < 0:
            print(f"::error::{name} cannot be negative", file=sys.stderr)
            return 2

    try:
        p95_ms, failures, requests = read_metrics(args.input)
    except QualityGateError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 2

    checks = {
        "p95_ms": p95_ms <= args.max_p95_ms,
        "failures": failures <= args.max_failures,
        "minimum_requests": requests >= args.min_requests,
    }
    values = {
        "p95_ms": f"{p95_ms:g}",
        "failures": f"{failures:g}",
        "requests": f"{requests:g}",
        "quality_gate": "passed" if all(checks.values()) else "failed",
    }
    write_github_output(values)

    print(
        "[locust-quality-gate] p95_ms=%s (max=%s), failures=%s (max=%s), "
        "requests=%s (min=%s)"
        % (
            values["p95_ms"],
            f"{args.max_p95_ms:g}",
            values["failures"],
            f"{args.max_failures:g}",
            values["requests"],
            f"{args.min_requests:g}",
        )
    )

    if all(checks.values()):
        print("[locust-quality-gate] PASSED")
        return 0

    failed_checks = ", ".join(name for name, passed in checks.items() if not passed)
    print(f"::error::Locust quality gate failed: {failed_checks}", file=sys.stderr)
    print("[locust-quality-gate] FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
