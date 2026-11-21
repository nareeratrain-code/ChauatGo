#!/usr/bin/env bash
set -Eeuo pipefail

# Upload notification secrets from a dotenv file without sourcing or eval-ing it.
# Usage:
#   chmod 700 scripts/config/set-github-notification-secrets.sh
#   ./scripts/config/set-github-notification-secrets.sh [path/to/.env] [owner/repo]
#
# The .env file must remain local and must never be committed.

ENV_FILE="${1:-.env}"
REPOSITORY="${2:-nareeratrain-code/ChauatGo}"

readonly REQUIRED_KEYS=(
  SLACK_WEBHOOK_URL
  TEAMS_WEBHOOK_URL
  EMAIL_SMTP_HOST
  EMAIL_FROM
  EMAIL_TO
)

readonly OPTIONAL_KEYS=(
  EMAIL_SMTP_PORT
  EMAIL_SMTP_USERNAME
  EMAIL_SMTP_PASSWORD
)

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed."
[[ -f "$ENV_FILE" ]] || error "dotenv file not found: $ENV_FILE"

if [[ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null)" =~ ^(644|664|666|755|775|777)$ ]]; then
  printf 'Warning: %s may be readable by other users; use chmod 600 %s\n' "$ENV_FILE" "$ENV_FILE" >&2
fi

gh auth status >/dev/null 2>&1 || error "gh is not authenticated. Run: gh auth login"

grep -Eq '^[[:space:]]*(export[[:space:]]+)?[A-Z_][A-Z0-9_]*[[:space:]]*=' "$ENV_FILE" \
  || error "No KEY=VALUE entries found in $ENV_FILE"

# Read a single dotenv key without executing the file. This supports blank lines,
# comments, optional 'export', whitespace around '=', and simple single/double quotes.
dotenv_get() {
  local key="$1"
  awk -v wanted="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line=$0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      match(line, /^[A-Z_][A-Z0-9_]*/)
      name=substr(line, RSTART, RLENGTH)
      if (name != wanted) next
      rest=substr(line, RSTART + RLENGTH)
      sub(/^[[:space:]]*=[[:space:]]*/, "", rest)
      sub(/[[:space:]]+#.*$/, "", rest)
      if (rest ~ /^".*"$/) {
        sub(/^"/, "", rest); sub(/"$/, "", rest)
      } else if (rest ~ /^'"'"'.*'"'"'$/) {
        sub(/^'"'"'/, "", rest); sub(/'"'"'$/, "", rest)
      }
      print rest
      found=1
      exit
    }
    END { if (!found) exit 1 }
  ' "$ENV_FILE"
}

set_secret() {
  local key="$1"
  local value
  if [[ $# -ge 2 ]]; then
    value="$2"
  else
    if ! value="$(dotenv_get "$key")"; then
      return 1
    fi
  fi
  if [[ -z "$value" ]]; then
    return 1
  fi

  printf 'Setting %s...\n' "$key"
  gh secret set "$key" --repo "$REPOSITORY" --body "$value" >/dev/null
}

missing=()
for key in "${REQUIRED_KEYS[@]}"; do
  if ! value="$(dotenv_get "$key")" || [[ -z "$value" ]]; then
    missing+=("$key")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required .env keys:\n' >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

# Email port defaults to 587 when omitted; write the default explicitly.
if ! smtp_port="$(dotenv_get EMAIL_SMTP_PORT)" || [[ -z "$smtp_port" ]]; then
  smtp_port=587
fi
[[ "$smtp_port" =~ ^[0-9]+$ ]] || error "EMAIL_SMTP_PORT must be numeric"

# Avoid accidentally sending credentials to the wrong repository.
printf 'Repository: %s\n' "$REPOSITORY"
printf 'dotenv file: %s\n' "$ENV_FILE"
printf 'The values themselves will not be printed.\n\n'

set_secret SLACK_WEBHOOK_URL || error "SLACK_WEBHOOK_URL is empty"
set_secret TEAMS_WEBHOOK_URL || error "TEAMS_WEBHOOK_URL is empty"
set_secret EMAIL_SMTP_HOST || error "EMAIL_SMTP_HOST is empty"
set_secret EMAIL_SMTP_PORT "$smtp_port"
set_secret EMAIL_FROM || error "EMAIL_FROM is empty"
set_secret EMAIL_TO || error "EMAIL_TO is empty"

username="$(dotenv_get EMAIL_SMTP_USERNAME 2>/dev/null || true)"
password="$(dotenv_get EMAIL_SMTP_PASSWORD 2>/dev/null || true)"
if [[ -n "$username" || -n "$password" ]]; then
  [[ -n "$username" && -n "$password" ]] || error "EMAIL_SMTP_USERNAME and EMAIL_SMTP_PASSWORD must be provided together"
  set_secret EMAIL_SMTP_USERNAME
  set_secret EMAIL_SMTP_PASSWORD
else
  printf 'Skipping optional SMTP username/password (both are empty).\n'
fi

printf '\nSecrets uploaded successfully to %s.\n' "$REPOSITORY"
printf 'Values were not printed or stored by this script.\n'
