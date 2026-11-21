#!/usr/bin/env bash
set -Eeuo pipefail

# Show the latest ChauatGo performance workflow result and artifact links.
# Usage:
#   ./scripts/ci/show-latest-performance-run.sh
#   ./scripts/ci/show-latest-performance-run.sh owner/repo main

REPOSITORY="${1:-nareeratrain-code/ChauatGo}"
BRANCH="${2:-main}"
WORKFLOW="${WORKFLOW:-Performance for important PRs and merges}"

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed."
command -v jq >/dev/null 2>&1 || error "jq is not installed."
gh auth status >/dev/null 2>&1 || error "gh is not authenticated. Run: gh auth login"

printf 'Repository: %s\n' "$REPOSITORY"
printf 'Workflow:   %s\n' "$WORKFLOW"
printf 'Branch:     %s\n\n' "$BRANCH"

RUN_JSON="$(gh run list \
  --repo "$REPOSITORY" \
  --workflow "$WORKFLOW" \
  --branch "$BRANCH" \
  --limit 1 \
  --json databaseId,headSha,status,conclusion,createdAt,updatedAt,url \
  --jq '.[0] // empty')"

[[ -n "$RUN_JSON" ]] || error "No workflow run found for $WORKFLOW on $BRANCH"

RUN_ID="$(jq -r '.databaseId' <<<"$RUN_JSON")"
RUN_URL="$(jq -r '.url' <<<"$RUN_JSON")"
HEAD_SHA="$(jq -r '.headSha' <<<"$RUN_JSON")"
LIST_STATUS="$(jq -r '.status' <<<"$RUN_JSON")"
LIST_CONCLUSION="$(jq -r '.conclusion // ""' <<<"$RUN_JSON")"

printf '%s\n' '== LATEST RUN =='
printf 'Run ID:     %s\n' "$RUN_ID"
printf 'Status:      %s\n' "$LIST_STATUS"
printf 'Conclusion:  %s\n' "${LIST_CONCLUSION:-pending}"
printf 'Commit:      %s\n' "$HEAD_SHA"
printf 'Created:     %s\n' "$(jq -r '.createdAt' <<<"$RUN_JSON")"
printf 'Updated:     %s\n' "$(jq -r '.updatedAt' <<<"$RUN_JSON")"
printf 'Run URL:     %s\n\n' "$RUN_URL"

printf '%s\n' '== JOB SUMMARY (gh run view) =='
gh run view "$RUN_ID" --repo "$REPOSITORY" --json status,conclusion,jobs \
  --jq '.jobs[] | [(.name // ""), (.status // ""), (.conclusion // "pending")] | @tsv' \
  | awk -F '\t' '{ printf "%-48s %-12s %s\n", $1, $2, $3 }'
printf '\n'

printf '%s\n' '== ARTIFACTS =='
ARTIFACTS_JSON="$(gh api \
  --repo "$REPOSITORY" \
  "/repos/$REPOSITORY/actions/runs/$RUN_ID/artifacts" \
  --jq '[.artifacts[] | {name,expired,created_at,expires_at,size_in_bytes,archive_download_url}]')"

if [[ "$(jq 'length' <<<"$ARTIFACTS_JSON")" -eq 0 ]]; then
  printf 'No Artifacts found for this run.\n'
else
  while IFS= read -r artifact; do
    name="$(jq -r '.name' <<<"$artifact")"
    expired="$(jq -r '.expired' <<<"$artifact")"
    created="$(jq -r '.created_at' <<<"$artifact")"
    expires="$(jq -r '.expires_at' <<<"$artifact")"
    size="$(jq -r '.size_in_bytes' <<<"$artifact")"
    download_url="$(jq -r '.archive_download_url' <<<"$artifact")"
    printf '\nName:       %s\n' "$name"
    printf 'Size:       %s bytes\n' "$size"
    printf 'Created:    %s\n' "$created"
    printf 'Expires:    %s\n' "$expires"
    printf 'Expired:    %s\n' "$expired"
    printf 'Download:   %s\n' "$download_url"
    printf 'CLI command: gh run download %s --repo %s --name %q --dir ./artifacts/%q\n' \
      "$RUN_ID" "$REPOSITORY" "$name" "$name"
  done < <(jq -c '.[]' <<<"$ARTIFACTS_JSON")
fi

printf '\n%s\n' '== OVERALL RESULT =='
if [[ "$LIST_STATUS" == "completed" && "$LIST_CONCLUSION" == "success" ]]; then
  printf 'PASS: latest workflow run completed successfully.\n'
  exit 0
elif [[ "$LIST_STATUS" == "completed" ]]; then
  printf 'FAIL: latest workflow run concluded with %s.\n' "${LIST_CONCLUSION:-unknown}"
  exit 2
else
  printf 'PENDING: latest workflow run is still %s.\n' "$LIST_STATUS"
  exit 3
fi
