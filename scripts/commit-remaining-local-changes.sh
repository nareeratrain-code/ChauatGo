#!/usr/bin/env bash
set -euo pipefail

# Create a focused Conventional Commit for the remaining local code/tests.
# functions/.env is intentionally excluded because it may contain environment
# flags or secrets. This script does not push or create a Pull Request.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FILES=(
  admin.html
  admin.js
  functions/index.js
  functions/test/payout-security.test.js
  rider.css
  rider.html
  rider.js
  tests/settlement-ui.test.js
  scripts/commit-admin-emulator.sh
  scripts/commit-ci-tests.sh
  scripts/test-native-appcheck-emulator.js
  tests/admin-emulator-config.test.js
  tests/dispatch-client-appcheck-error.test.js
  scripts/commit-remaining-local-changes.sh
)
COMMIT_SUBJECT="feat: harden admin app check and rider finance flows"

for file in "${FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing expected file: $file" >&2
    exit 1
  fi
done

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo "Unresolved merge conflicts detected. Resolve them before committing." >&2
  exit 1
fi

if git diff --name-only | grep -qx 'functions/.env'; then
  echo "Notice: functions/.env remains uncommitted intentionally." >&2
fi

# Prevent unrelated staged files from being included accidentally.
mapfile -t staged_files < <(git diff --cached --name-only)
for file in "${staged_files[@]}"; do
  case " ${FILES[*]} " in
    *" $file "*) ;;
    *)
      echo "Unrelated staged file detected: $file" >&2
      echo "Unstage it first, then rerun this script." >&2
      exit 1
      ;;
  esac
done

node --check admin.js
node --check rider.js
node --check functions/index.js
node --check functions/test/payout-security.test.js
node --check tests/admin-emulator-config.test.js
node --check tests/dispatch-client-appcheck-error.test.js
node --test \
  tests/admin-emulator-config.test.js \
  tests/admin-rider-lock-ui.test.js \
  tests/settlement-ui.test.js \
  tests/dispatch-client-appcheck-error.test.js \
  functions/test/payout-security.test.js

git diff --check -- "${FILES[@]}"
git add -- "${FILES[@]}"
git diff --cached --check

git commit \
  -m "$COMMIT_SUBJECT" \
  -m "Harden Admin local emulator safety, App Check client error handling, and rider remittance UI flows." \
  -m "Add regression coverage for payout security, settlement UI, and native App Check failures." \
  -m "Co-authored-by: Manus <dev-agent@manus.ai>"

echo
echo "Commit created successfully. No push was performed."
echo "functions/.env was intentionally left uncommitted."
git log -1 --format='%h %s%n%b'
