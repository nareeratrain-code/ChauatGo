#!/usr/bin/env bash
set -Eeuo pipefail

# Download and extract the Locust Artifact from a GitHub Actions run.
# Usage:
#   ./scripts/ci/download-latest-locust-artifact.sh
#   ./scripts/ci/download-latest-locust-artifact.sh --open
#   ./scripts/ci/download-latest-locust-artifact.sh RUN_ID
#   ./scripts/ci/download-latest-locust-artifact.sh RUN_ID OUTPUT_DIR --open
#
# The script uses gh run download, which downloads and extracts the Artifact.

REPOSITORY="${REPOSITORY:-nareeratrain-code/ChauatGo}"
WORKFLOW="${WORKFLOW:-Performance for important PRs and merges}"
BRANCH="${BRANCH:-main}"
RUN_ID=""
OUTPUT_DIR=""
OPEN_REPORT=false

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

for argument in "$@"; do
  case "$argument" in
    --open)
      OPEN_REPORT=true
      ;;
    -*)
      error "Unknown option: $argument"
      ;;
    *)
      if [[ -z "$RUN_ID" ]]; then
        RUN_ID="$argument"
      elif [[ -z "$OUTPUT_DIR" ]]; then
        OUTPUT_DIR="$argument"
      else
        error "Too many positional arguments"
      fi
      ;;
  esac
done

command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed."
command -v jq >/dev/null 2>&1 || error "jq is not installed."
gh auth status >/dev/null 2>&1 || error "gh is not authenticated. Run: gh auth login"

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(gh run list \
    --repo "$REPOSITORY" \
    --workflow "$WORKFLOW" \
    --branch "$BRANCH" \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')"
  [[ -n "$RUN_ID" ]] || error "No Performance workflow run found on $BRANCH"
fi

if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="./artifacts/locust-$RUN_ID"
fi

[[ "$RUN_ID" =~ ^[0-9]+$ ]] || error "RUN_ID must be numeric: $RUN_ID"

RUN_INFO="$(gh run view "$RUN_ID" --repo "$REPOSITORY" --json status,conclusion,url,headSha)"
STATUS="$(jq -r '.status' <<<"$RUN_INFO")"
CONCLUSION="$(jq -r '.conclusion // ""' <<<"$RUN_INFO")"
RUN_URL="$(jq -r '.url' <<<"$RUN_INFO")"
HEAD_SHA="$(jq -r '.headSha' <<<"$RUN_INFO")"

[[ "$STATUS" == "completed" ]] || error "Run $RUN_ID is not completed yet: $STATUS"

printf 'Repository: %s\n' "$REPOSITORY"
printf 'Run ID:     %s\n' "$RUN_ID"
printf 'Conclusion: %s\n' "${CONCLUSION:-unknown}"
printf 'Commit:     %s\n' "$HEAD_SHA"
printf 'Run URL:    %s\n\n' "$RUN_URL"

# The current workflow uses locust-performance-report. The fallback supports
# older runs that used locust-quality-gate.
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

[[ -n "$ARTIFACT_NAME" ]] || error "No non-expired Locust Artifact found for run $RUN_ID"

mkdir -p "$OUTPUT_DIR"
printf 'Downloading Artifact: %s\n' "$ARTIFACT_NAME"
printf 'Output directory:   %s\n' "$OUTPUT_DIR"

gh run download "$RUN_ID" \
  --repo "$REPOSITORY" \
  --name "$ARTIFACT_NAME" \
  --dir "$OUTPUT_DIR"

HTML_REPORT="$(find "$OUTPUT_DIR" -type f -name 'locust-report.html' -print -quit)"
[[ -n "$HTML_REPORT" ]] || error "locust-report.html was not found in $OUTPUT_DIR"

printf '\n== LOCUST REPORT ==\n'
printf 'HTML report: %s\n' "$HTML_REPORT"
printf 'Report URL:  %s\n' "$RUN_URL"
printf '\nExtracted files:\n'
find "$OUTPUT_DIR" -maxdepth 3 -type f -printf '  %p (%s bytes)\n' | sort

if [[ "$OPEN_REPORT" == true ]]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$HTML_REPORT" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$HTML_REPORT" >/dev/null 2>&1 &
  else
    printf 'Browser opener not found; open this file manually: %s\n' "$HTML_REPORT"
  fi
fi

if [[ "$CONCLUSION" == "success" ]]; then
  printf '\nPerformance run: PASS\n'
else
  printf '\nPerformance run: %s\n' "${CONCLUSION:-unknown}"
fi
