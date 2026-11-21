#!/usr/bin/env python3
"""Dry-run the Performance Release Sign-off GitHub Action locally.

This script models the important behavior of
.github/workflows/validate-performance-signoff.yml without calling GitHub API,
creating comments, changing labels, or using a real token.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

RELEASE_GATE_MARKER = "<!-- performance-release-gate -->"
SIGNOFF_MARKER_PREFIX = "<!-- performance-signoff:"
SUMMARY_MARKER = "<!-- performance-signoff-summary -->"
REQUIRED_ROLES = ("qa", "engineering", "sre", "product")
ROLE_NAMES = {
    "qa": "QA / Performance",
    "engineering": "Engineering",
    "sre": "SRE / Platform",
    "product": "Product / Operations",
}
DEFAULT_TEAMS = {
    "qa": "qa-team",
    "engineering": "engineering-team",
    "sre": "platform-team",
    "product": "product-team",
}


@dataclass
class Comment:
    author: str
    body: str
    bot: bool = False
    comment_id: int = 0


@dataclass
class Issue:
    number: int = 123
    state: str = "open"
    labels: set[str] = field(default_factory=lambda: {"release-gate", "performance"})
    body: str = RELEASE_GATE_MARKER
    comments: list[Comment] = field(default_factory=list)
    next_comment_id: int = 1000


class DryRunError(Exception):
    """Expected rejection in the local simulation."""


class SignoffDryRun:
    def __init__(self, org: str, team_members: dict[str, set[str]], verbose: bool = False):
        self.org = org
        self.team_members = team_members
        self.verbose = verbose
        self.issue = Issue()
        self.events: list[dict[str, Any]] = []

    def log(self, event: str, **details: Any) -> None:
        record = {"event": event, **details}
        self.events.append(record)
        if self.verbose:
            print(f"[dry-run] {event}: {details}")

    def is_release_gate(self) -> bool:
        return (
            self.issue.state == "open"
            and RELEASE_GATE_MARKER in self.issue.body
            and "release-gate" in self.issue.labels
        )

    def verify_membership(self, role: str, actor: str) -> bool:
        team = DEFAULT_TEAMS[role]
        member = actor in self.team_members.get(team, set())
        self.log(
            "team_membership_check",
            actor=actor,
            role=role,
            team=f"{self.org}/{team}",
            state="active" if member else "not_member",
        )
        return member

    def verified_roles(self) -> set[str]:
        roles: set[str] = set()
        for comment in self.issue.comments:
            if not comment.bot:
                continue
            for role in REQUIRED_ROLES:
                if f"{SIGNOFF_MARKER_PREFIX}{role} -->" in comment.body:
                    roles.add(role)
        return roles

    def update_labels(self, missing_roles: list[str]) -> None:
        self.issue.labels.add("performance")
        if missing_roles:
            self.issue.labels.update({"release-gate", "pending-signoff"})
            self.issue.labels.discard("release-approved")
        else:
            self.issue.labels.discard("release-gate")
            self.issue.labels.discard("pending-signoff")
            self.issue.labels.add("release-approved")
        self.log("labels_updated", labels=sorted(self.issue.labels))

    def update_summary(self, actor: str, role: str, missing_roles: list[str]) -> str:
        status = [
            f"- {'✅' if required in self.verified_roles() else '⏳'} "
            f"{ROLE_NAMES[required]} (`{required}`)"
            for required in REQUIRED_ROLES
        ]
        decision = (
            "**Decision status: READY FOR PRODUCTION APPROVAL**"
            if not missing_roles
            else f"**Decision status: PENDING — missing: {', '.join(missing_roles)}**"
        )
        return "\n".join(
            [
                SUMMARY_MARKER,
                "## Performance Release Gate Sign-off Status",
                "",
                *status,
                "",
                decision,
                "",
                f"Last verified sign-off: @{actor} ({ROLE_NAMES[role]})",
            ]
        )

    def handle_comment(self, actor: str, body: str) -> str:
        command = body.strip().lower()
        if not command.startswith("/signoff"):
            self.log("ignored_comment", actor=actor, reason="not_signoff_command")
            return "ignored"

        if not self.is_release_gate():
            self.log("rejected", actor=actor, reason="not_open_release_gate_issue")
            raise DryRunError("Issue is not an open Release Gate Issue")

        role_match = next(
            (role for role in REQUIRED_ROLES if command == f"/signoff {role}"),
            None,
        )
        if role_match is None:
            self.log("ignored_comment", actor=actor, reason="invalid_signoff_command")
            return "ignored"

        role = role_match
        if not self.verify_membership(role, actor):
            self.log("rejected", actor=actor, role=role, reason="not_team_member")
            raise DryRunError(
                f"@{actor} is not a member of {self.org}/{DEFAULT_TEAMS[role]}"
            )

        marker = f"{SIGNOFF_MARKER_PREFIX}{role} -->"
        audit_body = "\n".join(
            [
                marker,
                f"### Sign-off recorded: {ROLE_NAMES[role]}",
                "",
                f"- Approved by: @{actor}",
                f"- Verified team: @{self.org}/{DEFAULT_TEAMS[role]}",
                "- Membership state: active",
                "- Source comment: local-dry-run",
                f"- Recorded at: {datetime.now(timezone.utc).isoformat()}",
            ]
        )
        existing = next(
            (comment for comment in self.issue.comments if comment.bot and marker in comment.body),
            None,
        )
        if existing:
            existing.body = audit_body
            self.log("audit_updated", actor=actor, role=role, comment_id=existing.comment_id)
        else:
            self.issue.next_comment_id += 1
            self.issue.comments.append(
                Comment(
                    author="github-actions[bot]",
                    body=audit_body,
                    bot=True,
                    comment_id=self.issue.next_comment_id,
                )
            )
            self.log("audit_created", actor=actor, role=role, comment_id=self.issue.next_comment_id)

        missing_roles = [required for required in REQUIRED_ROLES if required not in self.verified_roles()]
        summary = self.update_summary(actor, role, missing_roles)
        summary_comment = next(
            (comment for comment in self.issue.comments if comment.bot and SUMMARY_MARKER in comment.body),
            None,
        )
        if summary_comment:
            summary_comment.body = summary
        else:
            self.issue.next_comment_id += 1
            self.issue.comments.append(
                Comment(
                    author="github-actions[bot]",
                    body=summary,
                    bot=True,
                    comment_id=self.issue.next_comment_id,
                )
            )
        self.update_labels(missing_roles)
        result = "ready" if not missing_roles else "accepted"
        self.log("signoff_accepted", actor=actor, role=role, missing_roles=missing_roles)
        return result

    def snapshot(self) -> dict[str, Any]:
        return {
            "labels": sorted(self.issue.labels),
            "verified_roles": sorted(self.verified_roles()),
            "audit_comments": [
                {
                    "id": comment.comment_id,
                    "body": comment.body,
                }
                for comment in self.issue.comments
                if comment.bot and SIGNOFF_MARKER_PREFIX in comment.body
            ],
            "events": self.events,
        }


def make_default_dry_run(verbose: bool = False) -> SignoffDryRun:
    return SignoffDryRun(
        org="nareeratrain-code",
        team_members={
            "qa-team": {"qa-user"},
            "engineering-team": {"eng-user"},
            "platform-team": {"sre-user"},
            "product-team": {"product-user"},
        },
        verbose=verbose,
    )


def scenario_all(verbose: bool = False) -> tuple[bool, dict[str, Any]]:
    dry_run = make_default_dry_run(verbose)
    checks: list[dict[str, Any]] = []

    initial_signoffs = (("qa", "qa-user"), ("engineering", "eng-user"))
    for role, actor in initial_signoffs:
        result = dry_run.handle_comment(actor, f"/signoff {role}")
        checks.append({"case": f"valid {role}", "result": result, "passed": result in {"accepted", "ready"}})

    duplicate_result = dry_run.handle_comment("eng-user", "/signoff engineering")
    audit_count = sum(
        1 for comment in dry_run.issue.comments
        if comment.bot and "<!-- performance-signoff:engineering -->" in comment.body
    )
    checks.append({
        "case": "duplicate engineering sign-off updates existing audit",
        "result": duplicate_result,
        "passed": audit_count == 1,
    })

    for role, actor in (("sre", "sre-user"), ("product", "product-user")):
        result = dry_run.handle_comment(actor, f"/signoff {role}")
        checks.append({"case": f"valid {role}", "result": result, "passed": result in {"accepted", "ready"}})

    ready = "release-approved" in dry_run.issue.labels
    checks.append({
        "case": "all required roles approved",
        "result": sorted(dry_run.verified_roles()),
        "passed": ready and set(dry_run.verified_roles()) == set(REQUIRED_ROLES),
    })

    return all(check["passed"] for check in checks), {
        "checks": checks,
        "final_snapshot": dry_run.snapshot(),
    }


def scenario_rejections(verbose: bool = False) -> tuple[bool, dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    dry_run = make_default_dry_run(verbose)
    try:
        dry_run.handle_comment("unknown-user", "/signoff engineering")
    except DryRunError:
        checks.append({"case": "non-team member rejected", "passed": True})
    else:
        checks.append({"case": "non-team member rejected", "passed": False})

    invalid_result = dry_run.handle_comment("qa-user", "/signoff qa extra")
    checks.append({"case": "invalid command ignored", "result": invalid_result, "passed": invalid_result == "ignored"})

    closed = make_default_dry_run(verbose)
    closed.issue.state = "closed"
    try:
        closed.handle_comment("qa-user", "/signoff qa")
    except DryRunError:
        checks.append({"case": "closed issue rejected", "passed": True})
    else:
        checks.append({"case": "closed issue rejected", "passed": False})

    return all(check["passed"] for check in checks), {"checks": checks}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scenario",
        choices=("all", "rejections"),
        default="all",
        help="Dry-run scenario to execute (default: all)",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    parser.add_argument("--verbose", action="store_true", help="Print each simulated API/action event")
    args = parser.parse_args()

    passed, report = (
        scenario_all(args.verbose)
        if args.scenario == "all"
        else scenario_rejections(args.verbose)
    )
    report["scenario"] = args.scenario
    report["passed"] = passed
    report["api_calls"] = "simulated locally; no GitHub API calls made"

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"Scenario: {args.scenario}")
        for check in report["checks"]:
            status = "PASS" if check["passed"] else "FAIL"
            print(f"[{status}] {check['case']}")
        if "final_snapshot" in report:
            print(f"Verified roles: {', '.join(report['final_snapshot']['verified_roles'])}")
            print(f"Final labels: {', '.join(report['final_snapshot']['labels'])}")
        print(f"Result: {'PASS' if passed else 'FAIL'}")
        print("GitHub API: NOT CALLED (local simulation only)")

    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
