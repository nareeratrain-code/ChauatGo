"""Unit tests for the Locust result summary and notification script."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from scripts.performance import summarize_locust_results as summary


def write_result(tmp_path: Path, *, failures: int = 0) -> Path:
    path = tmp_path / "locust-results.json"
    path.write_text(
        json.dumps(
            {
                "stats": [
                    {
                        "name": "Aggregated",
                        "num_requests": 1000,
                        "num_failures": failures,
                        "requests_per_second": 33.33,
                        "avg_response_time": 112,
                        "response_time_percentile_0.50": 90,
                        "response_time_percentile_0.95": 150,
                        "response_time_percentile_0.99": 180,
                        "max_response_time": 420,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    return path


def test_zero_failure_rate_is_pass_and_preserves_zero_metrics(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = write_result(tmp_path, failures=0)

    metrics = summary.build_report(json.loads(path.read_text(encoding="utf-8")), None)

    assert metrics["failures"] == 0
    assert metrics["failure_rate"] == 0

    summary.print_report(path, metrics, max_failure_rate=1, max_p95_ms=200, passed=True)
    output = capsys.readouterr().out
    assert "Failures:       0" in output
    assert "Failure rate:   0%" in output
    assert "Result:         PASS" in output


def test_zero_failure_rate_sends_pass_slack_payload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = write_result(tmp_path, failures=0)
    sent: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://example.test/slack")
    monkeypatch.setattr(
        summary,
        "post_json",
        lambda url, payload: sent.append((url, payload)),
    )

    metrics = summary.build_report(json.loads(path.read_text(encoding="utf-8")), None)
    assert summary.send_notifications(
        path,
        metrics,
        max_failure_rate=1,
        max_p95_ms=200,
        passed=True,
        mode="slack",
        slack_env="SLACK_WEBHOOK_URL",
        teams_env="TEAMS_WEBHOOK_URL",
    )

    assert len(sent) == 1
    assert sent[0][0] == "https://example.test/slack"
    text = sent[0][1]["text"]
    assert isinstance(text, str)
    assert "Locust Threshold: PASS" in text
    assert "Failures: 0" in text
    assert "Failure rate: 0% (max 1%)" in text


@pytest.mark.parametrize(
    "error_message",
    [
        "file not found: locust-results.json",
        "GitHub Actions run 44680184450 timed out after 30 minutes",
    ],
)
def test_error_message_sends_error_slack_notification(
    monkeypatch: pytest.MonkeyPatch, error_message: str
) -> None:
    sent: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://example.test/slack")
    monkeypatch.setattr(
        summary,
        "post_json",
        lambda url, payload: sent.append((url, payload)),
    )

    assert (
        summary.send_error_notifications(
            error_message,
            mode="slack",
            slack_env="SLACK_WEBHOOK_URL",
            teams_env="TEAMS_WEBHOOK_URL",
        )
        is True
    )

    assert len(sent) == 1
    assert sent[0][0] == "https://example.test/slack"
    text = sent[0][1]["text"]
    assert text == f"Locust Performance: ERROR\nError: {error_message}"


def test_cli_error_message_returns_error_exit_code_and_notifies(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sent: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://example.test/slack")
    monkeypatch.setattr(
        summary,
        "post_json",
        lambda url, payload: sent.append((url, payload)),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "summarize_locust_results.py",
            "--error-message",
            "GitHub Actions workflow failed",
            "--notify",
            "slack",
        ],
    )

    assert summary.main() == 2
    assert len(sent) == 1
    assert "Locust Performance: ERROR" in sent[0][1]["text"]
    assert "GitHub Actions workflow failed" in sent[0][1]["text"]
    assert "Error notification sent: Slack" in capsys.readouterr().out
