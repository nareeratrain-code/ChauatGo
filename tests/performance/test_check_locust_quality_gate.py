"""Unit tests for the Locust JSON quality gate."""

from __future__ import annotations

import json
import runpy
import sys
from pathlib import Path

import pytest

from scripts.performance import check_locust_quality_gate as gate



def write_json(tmp_path: Path, payload: object, name: str = "locust-results.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path



def run_main(monkeypatch: pytest.MonkeyPatch, path: Path, *args: str) -> int:
    monkeypatch.setattr(
        sys,
        "argv",
        ["check_locust_quality_gate.py", "--input", str(path), *args],
    )
    return gate.main()


@pytest.mark.parametrize("aggregate_name", ["Aggregated", "Aggregate", "Total", "All"])
def test_read_metrics_selects_named_aggregate_row(
    tmp_path: Path, aggregate_name: str
) -> None:
    path = write_json(
        tmp_path,
        {
            "stats": [
                {
                    "name": "GET rider entry point",
                    "num_requests": 99,
                    "num_failures": 4,
                    "response_time_percentile_0.95": 9999,
                },
                {
                    "name": aggregate_name,
                    "num_requests": 100,
                    "num_failures": 1,
                    "response_time_percentile_0.95": 1200,
                },
            ]
        },
    )

    assert gate.read_metrics(path) == (1200, 1, 100)



def test_read_metrics_selects_explicit_aggregated_row(tmp_path: Path) -> None:
    path = write_json(
        tmp_path,
        {
            "stats": [
                {
                    "aggregated": True,
                    "num_requests": 10,
                    "num_failures": 0,
                    "p95": 350,
                }
            ]
        },
    )

    assert gate.read_metrics(path) == (350, 0, 10)


def test_read_metrics_skips_non_dict_stats_rows(tmp_path: Path) -> None:
    path = write_json(
        tmp_path,
        {
            "stats": [
                None,
                "not-a-row",
                {
                    "name": "Aggregated",
                    "num_requests": 4,
                    "num_failures": 0,
                    "p95": 80,
                },
            ]
        },
    )

    assert gate.read_metrics(path) == (80, 0, 4)



def test_read_metrics_accepts_single_stats_row_as_aggregate(tmp_path: Path) -> None:
    path = write_json(
        tmp_path,
        {
            "stats": [
                {
                    "name": "GET /rider.html",
                    "num_requests": 10,
                    "num_failures": 0,
                    "p95_latency_ms": 250,
                }
            ]
        },
    )

    assert gate.read_metrics(path) == (250, 0, 10)



def test_read_metrics_accepts_top_level_total_fields(tmp_path: Path) -> None:
    path = write_json(
        tmp_path,
        {
            "total_requests": 100,
            "total_failures": 0,
            "total_p95_latency_ms": 875,
        },
    )

    assert gate.read_metrics(path) == (875, 0, 100)


@pytest.mark.parametrize(
    "p95_key",
    [
        "response_time_percentile_0.95",
        "response_time_percentile_95",
        "p95_latency_ms",
        "p95",
        "total_response_time_percentile_0.95",
        "total_response_time_percentile_95",
        "total_p95_latency_ms",
        "total_p95",
    ],
)
def test_read_metrics_supports_all_p95_key_aliases(tmp_path: Path, p95_key: str) -> None:
    path = write_json(
        tmp_path,
        {p95_key: 101, "num_requests": 2, "num_failures": 0},
    )

    p95, failures, requests = gate.read_metrics(path)
    assert (p95, failures, requests) == (101, 0, 2)


@pytest.mark.parametrize("failure_key", ["num_failures", "failures", "total_failures"])
def test_read_metrics_supports_failure_key_aliases(
    tmp_path: Path, failure_key: str
) -> None:
    path = write_json(
        tmp_path,
        {"p95": 101, failure_key: 3, "num_requests": 5},
    )

    assert gate.read_metrics(path) == (101, 3, 5)


@pytest.mark.parametrize("request_key", ["num_requests", "requests", "total_requests"])
def test_read_metrics_supports_request_key_aliases(
    tmp_path: Path, request_key: str
) -> None:
    path = write_json(
        tmp_path,
        {"p95": 101, "num_failures": 0, request_key: 5},
    )

    assert gate.read_metrics(path) == (101, 0, 5)


@pytest.mark.parametrize(
    ("p95", "max_p95", "expected_exit"),
    [(2000, 2000, 0), (2000.1, 2000, 1)],
)
def test_p95_threshold_boundary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    p95: float,
    max_p95: float,
    expected_exit: int,
) -> None:
    path = write_json(
        tmp_path,
        {"p95": p95, "num_failures": 0, "num_requests": 10},
    )

    assert run_main(monkeypatch, path, "--max-p95-ms", str(max_p95)) == expected_exit


@pytest.mark.parametrize(
    ("failures", "max_failures", "expected_exit"),
    [(0, 0, 0), (1, 0, 1), (2, 2, 0)],
)
def test_failure_threshold_boundary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failures: int,
    max_failures: int,
    expected_exit: int,
) -> None:
    path = write_json(
        tmp_path,
        {"p95": 100, "num_failures": failures, "num_requests": 10},
    )

    assert run_main(
        monkeypatch,
        path,
        "--max-failures",
        str(max_failures),
    ) == expected_exit


@pytest.mark.parametrize(
    ("requests", "min_requests", "expected_exit"),
    [(10, 10, 0), (9, 10, 1), (0, 1, 1)],
)
def test_minimum_request_threshold(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    requests: int,
    min_requests: int,
    expected_exit: int,
) -> None:
    path = write_json(
        tmp_path,
        {"p95": 100, "num_failures": 0, "num_requests": requests},
    )

    assert run_main(
        monkeypatch,
        path,
        "--min-requests",
        str(min_requests),
    ) == expected_exit



def test_quality_gate_writes_github_outputs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = write_json(
        tmp_path,
        {"p95": 450, "num_failures": 0, "num_requests": 20},
    )
    output = tmp_path / "github-output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))

    assert run_main(monkeypatch, path) == 0
    assert output.read_text(encoding="utf-8").splitlines() == [
        "p95_ms=450",
        "failures=0",
        "requests=20",
        "quality_gate=passed",
    ]


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"stats": [{"name": "one"}, {"name": "two"}]},
    ],
)
def test_read_metrics_rejects_unsupported_root_or_stats_shape(
    tmp_path: Path, payload: object
) -> None:
    path = write_json(tmp_path, payload)

    with pytest.raises(gate.QualityGateError):
        gate.read_metrics(path)


@pytest.mark.parametrize(
    "payload",
    [
        {"p95": 100, "num_failures": 0},
        {"num_failures": 0, "num_requests": 10},
        {"p95": 100, "num_requests": 10},
    ],
)
def test_read_metrics_rejects_missing_required_metric(
    tmp_path: Path, payload: dict[str, object]
) -> None:
    path = write_json(tmp_path, payload)

    with pytest.raises(gate.QualityGateError):
        gate.read_metrics(path)


@pytest.mark.parametrize("value", ["not-a-number", None])
def test_read_metrics_rejects_non_numeric_metric(tmp_path: Path, value: object) -> None:
    path = write_json(
        tmp_path,
        {"p95": value, "num_failures": 0, "num_requests": 10},
    )

    with pytest.raises(gate.QualityGateError):
        gate.read_metrics(path)


@pytest.mark.parametrize(
    "payload",
    [
        {"p95": -1, "num_failures": 0, "num_requests": 10},
        {"p95": 100, "num_failures": -1, "num_requests": 10},
        {"p95": 100, "num_failures": 0, "num_requests": -1},
    ],
)
def test_read_metrics_rejects_negative_metric(tmp_path: Path, payload: dict[str, object]) -> None:
    path = write_json(tmp_path, payload)

    with pytest.raises(gate.QualityGateError):
        gate.read_metrics(path)



def test_read_metrics_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(gate.QualityGateError, match="not found"):
        gate.read_metrics(tmp_path / "missing.json")



def test_read_metrics_rejects_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "broken.json"
    path.write_text("{not valid json", encoding="utf-8")

    with pytest.raises(gate.QualityGateError, match="Invalid JSON"):
        gate.read_metrics(path)


@pytest.mark.parametrize("argument", ["--max-p95-ms", "--max-failures", "--min-requests"])
def test_main_rejects_negative_threshold(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, argument: str
) -> None:
    path = write_json(
        tmp_path,
        {"p95": 100, "num_failures": 0, "num_requests": 10},
    )

    assert run_main(monkeypatch, path, argument, "-1") == 2



def test_main_returns_parse_error_for_missing_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert run_main(monkeypatch, tmp_path / "missing.json") == 2


def test_script_entrypoint_exits_with_main_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = write_json(
        tmp_path,
        {"p95": 100, "num_failures": 0, "num_requests": 10},
    )
    monkeypatch.setattr(
        sys,
        "argv",
        ["check_locust_quality_gate.py", "--input", str(path)],
    )

    with pytest.raises(SystemExit) as exit_info:
        runpy.run_path(str(Path(gate.__file__)), run_name="__main__")

    assert exit_info.value.code == 0
