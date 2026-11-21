#!/usr/bin/env bash
set -Eeuo pipefail

# End-to-end local helper:
# 1) Dispatch GitHub Actions workflow
# 2) Wait for the new run to finish
# 3) Download the Locust Artifact with gh run download
# 4) Evaluate locust-results.json with the Python threshold checker
# 5) Optionally notify Slack/Teams through the Python script
#
# Required commands: gh, jq, python3
# Required auth: gh auth login
# Required notification env vars when --notify is enabled:
#   SLACK_WEBHOOK_URL and/or TEAMS_WEBHOOK_URL

REPOSITORY="${REPOSITORY:-nareeratrain-code/ChauatGo}"
WORKFLOW="${WORKFLOW:-Performance for important PRs and merges}"
REF="${REF:-main}"
USERS="${USERS:-2}"
SPAWN_RATE="${SPAWN_RATE:-1}"
RUN_TIME="${RUN_TIME:-10s}"
MAX_FAILURE_RATE="${MAX_FAILURE_RATE:-1}"
MAX_P95_MS="${MAX_P95_MS:-200}"
DURATION_SECONDS="${DURATION_SECONDS:-}"
NOTIFY_MODE="${NOTIFY_MODE:-auto}"
OUTPUT_ROOT="${OUTPUT_ROOT:-./artifacts}"
WATCH_TIMEOUT_MINUTES="${WATCH_TIMEOUT_MINUTES:-30}"

usage() {
  cat <<'EOF'
Usage:
  run-performance-and-notify.sh [options]

Options:
  --repo REPOSITORY       GitHub repository (default: nareeratrain-code/ChauatGo)
  --ref BRANCH            Branch/ref to dispatch (default: main)
  --users N               Locust users (default: 2)
  --spawn-rate N          Locust spawn rate (default: 1)
  --run-time DURATION     Locust duration (default: 10s)
  --max-failure-rate PCT  Failure-rate budget (default: 1)
  --max-p95-ms MS         P95 budget (default: 200)
  --duration-seconds SEC  Duration for RPS calculation when JSON has none
  --notify MODE           auto|none|slack|teams|both (default: auto)
  --output-root DIR       Artifact output root (default: ./artifacts)
  --watch-timeout-min N   Maximum time to wait for GitHub run (default: 30)
  --help                  Show this help

Examples:
  ./scripts/ci/run-performance-and-notify.sh
  ./scripts/ci/run-performance-and-notify.sh --users 5 --run-time 30s --notify both
  ./scripts/ci/run-performance-and-notify.sh --notify none
EOF
}

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPOSITORY="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --users) USERS="$2"; shift 2 ;;
    --spawn-rate) SPAWN_RATE="$2"; shift 2 ;;
    --run-time) RUN_TIME="$2"; shift 2 ;;
    --max-failure-rate) MAX_FAILURE_RATE="$2"; shift 2 ;;
    --max-p95-ms) MAX_P95_MS="$2"; shift 2 ;;
    --duration-seconds) DURATION_SECONDS="$2"; shift 2 ;;
    --notify) NOTIFY_MODE="$2"; shift 2 ;;
    --output-root) OUTPUT_ROOT="$2"; shift 2 ;;
    --watch-timeout-min) WATCH_TIMEOUT_MINUTES="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) error "Unknown option: $1" ;;
  esac
done

command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed."
command -v jq >/dev/null 2>&1 || error "jq is not installed."
command -v python3 >/dev/null 2>&1 || error "python3 is not installed."
command -v timeout >/dev/null 2>&1 || error "timeout is not installed."
gh auth status >/dev/null 2>&1 || error "gh is not authenticated. Run: gh auth login"
[[ "$USERS" =~ ^[1-9][0-9]*$ ]] || error "--users must be a positive integer"
[[ "$SPAWN_RATE" =~ ^[1-9][0-9]*$ ]] || error "--spawn-rate must be a positive integer"
[[ "$MAX_P95_MS" =~ ^[0-9]+([.][0-9]+)?$ ]] || error "--max-p95-ms must be non-negative"
[[ "$MAX_FAILURE_RATE" =~ ^[0-9]+([.][0-9]+)?$ ]] || error "--max-failure-rate must be non-negative"
case "$NOTIFY_MODE" in auto|none|slack|teams|both) ;; *) error "--notify must be auto, none, slack, teams, or both" ;; esac
[[ "$WATCH_TIMEOUT_MINUTES" =~ ^[1-9][0-9]*$ ]] || error "--watch-timeout-min must be a positive integer"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SUMMARY_SCRIPT="$SCRIPT_DIR/../performance/summarize_locust_results.py"
[[ -f "$SUMMARY_SCRIPT" ]] || error "Summary script not found: $SUMMARY_SCRIPT"

notify_error() {
  local message="$1"
  printf 'ERROR: %s\n' "$message" >&2
  if [[ "$NOTIFY_MODE" != "none" ]]; then
    python3 "$SUMMARY_SCRIPT" \
      --error-message "$message" \
      --notify "$NOTIFY_MODE" \
      >/tmp/chauatgo-performance-error-notification.log 2>&1 || true
    cat /tmp/chauatgo-performance-error-notification.log >&2
  fi
}

printf 'Dispatching workflow: %s\n' "$WORKFLOW"
printf 'Repository/ref:       %s @ %s\n' "$REPOSITORY" "$REF"
printf 'Load profile:         users=%s spawn-rate=%s duration=%s\n' "$USERS" "$SPAWN_RATE" "$RUN_TIME"

if ! gh workflow run "$WORKFLOW" \
  --repo "$REPOSITORY" \
  --ref "$REF" \
  -f ref="$REF" \
  -f run_locust=true \
  -f locust_users="$USERS" \
  -f locust_spawn_rate="$SPAWN_RATE" \
  -f locust_run_time="$RUN_TIME" \
  -f locust_max_p95_ms=2000 \
  -f locust_max_p99_ms=4000 \
  -f locust_normal_weight=6 \
  -f locust_filter_weight=3 \
  -f locust_asset_weight=1; then
  notify_error "failed to dispatch GitHub Actions workflow"
  exit 1
fi

RUN_ID=""
for attempt in $(seq 1 12); do
  RUN_ID="$(gh run list \
    --repo "$REPOSITORY" \
    --workflow "$WORKFLOW" \
    --event workflow_dispatch \
    --limit 10 \
    --json databaseId,createdAt,headSha \
    --jq '.[0].databaseId // empty' 2>/dev/null || true)"
  [[ -n "$RUN_ID" ]] && break
  sleep 5
done
[[ -n "$RUN_ID" ]] || error "Could not identify the newly dispatched workflow run"

printf 'Workflow Run ID: %s\n' "$RUN_ID"
RUN_URL="$(gh run view "$RUN_ID" --repo "$REPOSITORY" --json url --jq '.url')"
printf 'Run URL: %s\n' "$RUN_URL"

set +e
timeout "${WATCH_TIMEOUT_MINUTES}m" gh run watch "$RUN_ID" --repo "$REPOSITORY" --exit-status --log
workflow_rc=$?
set -e

if [[ "$workflow_rc" -eq 124 ]]; then
  notify_error "GitHub Actions run $RUN_ID timed out after ${WATCH_TIMEOUT_MINUTES} minutes ($RUN_URL)"
elif [[ "$workflow_rc" -ne 0 ]]; then
  notify_error "GitHub Actions run $RUN_ID failed or was cancelled ($RUN_URL)"
fi

RUN_INFO="$(gh run view "$RUN_ID" --repo "$REPOSITORY" --json status,conclusion --jq '{status, conclusion}')"
STATUS="$(jq -r '.status' <<<"$RUN_INFO")"
CONCLUSION="$(jq -r '.conclusion // empty' <<<"$RUN_INFO")"
printf '\nWorkflow status: %s (%s)\n' "$STATUS" "${CONCLUSION:-pending}"

OUTPUT_DIR="$OUTPUT_ROOT/locust-$RUN_ID"
mkdir -p "$OUTPUT_DIR"
ARTIFACT_NAME=""
for candidate in "locust-performance-report-$RUN_ID" "locust-quality-gate-$RUN_ID"; do
  if gh api \
      --repo "$REPOSITORY" \
      "/repos/$REPOSITORY/actions/runs/$RUN_ID/artifacts" \
      --jq ".artifacts[] | select(.name == \"$candidate\" and .expired == false) | .name" \
      | grep -Fxq "$candidate"; then
    ARTIFACT_NAME="$candidate"
    break
  fi
done
if [[ -z "$ARTIFACT_NAME" ]]; then
  notify_error "No non-expired Locust Artifact found for Run $RUN_ID ($RUN_URL)"
  exit 1
fi

gh run download "$RUN_ID" \
  --repo "$REPOSITORY" \
  --name "$ARTIFACT_NAME" \
  --dir "$OUTPUT_DIR"

RESULTS_JSON="$(find "$OUTPUT_DIR" -type f -name 'locust-results.json' -print -quit)"
if [[ -z "$RESULTS_JSON" ]]; then
  notify_error "locust-results.json was not found in downloaded Artifact ($RUN_URL)"
  exit 1
fi

summary_args=(
  "$RESULTS_JSON"
  --max-failure-rate "$MAX_FAILURE_RATE"
  --max-p95-ms "$MAX_P95_MS"
)
if [[ "$workflow_rc" -eq 0 ]]; then
  summary_args+=(--notify "$NOTIFY_MODE")
else
  # A workflow error/timeout already produced an ERROR notification above;
  # avoid sending a duplicate threshold notification for the same run.
  summary_args+=(--notify none)
fi
if [[ -n "$DURATION_SECONDS" ]]; then
  summary_args+=(--duration-seconds "$DURATION_SECONDS")
fi

set +e
python3 "$SUMMARY_SCRIPT" "${summary_args[@]}"
summary_rc=$?
set -e

printf '\nDownloaded Artifact: %s\n' "$ARTIFACT_NAME"
printf 'Results JSON:       %s\n' "$RESULTS_JSON"
if html_report="$(find "$OUTPUT_DIR" -type f -name 'locust-report.html' -print -quit)"; then
  [[ -n "$html_report" ]] && printf 'HTML report:         %s\n' "$html_report"
fi

if [[ "$workflow_rc" -ne 0 || "$summary_rc" -ne 0 ]]; then
  printf '\nOVERALL RESULT: FAIL (workflow=%s, threshold/notification=%s)\n' "$workflow_rc" "$summary_rc"
  exit 1
fi
printf '\nOVERALL RESULT: PASS\n'
