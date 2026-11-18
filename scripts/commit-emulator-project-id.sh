#!/usr/bin/env bash
set -euo pipefail

# Create a focused Conventional Commit for the Emulator project-ID fix.
# This script does not push or create a Pull Request.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FILES=(
  .github/workflows/test.yml
  package.json
  functions/package.json
  storage.rules
  functions/test/rules/storage-rules.test.js
  scripts/commit-emulator-project-id.sh
)
COMMIT_SUBJECT="test: align emulator project id across integration tests"

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

node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); JSON.parse(require('fs').readFileSync('functions/package.json', 'utf8'))"
bash -n scripts/commit-emulator-project-id.sh
node --test tests/admin-emulator-config.test.js tests/admin-payout-audit.test.js tests/admin-rider-lock-ui.test.js tests/settlement-ui.test.js
git diff --check -- "${FILES[@]}"
git add -- "${FILES[@]}"
git diff --cached --check

npm run test:emu:all

git commit \
  -m "$COMMIT_SUBJECT" \
  -m "Use chauat-go-b9841 consistently for Auth, Firestore, Storage, and Functions Emulator tests." \
  -m "Keep acceptOffer rider-photo ownership checks and Storage Rules regression coverage intact." \
  -m "Co-authored-by: Manus <dev-agent@manus.ai>"

echo
echo "Commit created successfully. No push was performed."
git log -1 --format='%h %s%n%b'
