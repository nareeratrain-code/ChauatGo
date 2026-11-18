#!/usr/bin/env bash
set -euo pipefail

# Create a focused Conventional Commit for the Admin Emulator safety changes.
# This script intentionally does not push or create a Pull Request.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FILES=(
  admin.js
  admin.html
  tests/admin-emulator-config.test.js
)
COMMIT_SUBJECT="feat(admin): isolate localhost with Firebase emulators"

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

# Do not accidentally include unrelated files that may already be staged.
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
node --check tests/admin-emulator-config.test.js
node --test \
  tests/admin-emulator-config.test.js \
  tests/admin-payout-audit.test.js \
  tests/admin-rider-lock-ui.test.js \
  tests/settlement-ui.test.js

git diff --check -- "${FILES[@]}"
git add -- "${FILES[@]}"
git diff --cached --check

git commit \
  -m "$COMMIT_SUBJECT" \
  -m "Add explicit localhost emulator wiring for Auth, Firestore, Storage, and Functions." \
  -m "Fail closed when Admin is opened locally without ?emulator=1." \
  -m "Add regression coverage for SDK loading and emulator safety." \
  -m "Co-authored-by: Manus <dev-agent@manus.ai>"

echo
echo "Commit created successfully. No push was performed."
git log -1 --format='%h %s%n%b'
