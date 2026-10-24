#!/usr/bin/env bash
# ============================================================================
# juneau-love — CI workflow contract test
#
# The CI feature (the PR merge gate) is a GitHub Actions workflow, so its
# runtime behavior — the suites actually passing on a runner — is only
# observable on GitHub. This test pins the local contract the workflow
# must satisfy:
#
#   .github/workflows/ci.yml
#     - runs on pull_request (so its checks can gate PR merges) and on
#       push to main
#     - an `integration` job: installs the committed lockfile, starts the
#       local Supabase stack, runs supabase/tests/flows.sh
#     - a `playwright` job: installs the committed lockfile, starts the
#       local Supabase stack, runs npx playwright test
#     - the jobs are independent — neither `needs` the other — so they run
#       in parallel and one side failing does not suppress the other's
#       signal
#
# Usage:  bash tests/ci-workflow.sh
# Exits non-zero if any check fails.
# ============================================================================
set -u
cd "$(dirname "$0")/.."

WF=.github/workflows/ci.yml
FAILURES=0

check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    FAILURES=$((FAILURES + 1))
  fi
}

no_needs() { ! grep -Eq '^[[:space:]]*needs:' <<<"$1"; }

# Print the YAML block of a top-level job (job keys sit at 2-space indent).
job_block() {
  awk -v job="  $1:" '
    $0 == job { inblock = 1; print; next }
    inblock && (/^[^ ]/ || /^  [A-Za-z0-9_-]+:/) { exit }
    inblock { print }
  ' "$WF"
}

if [[ ! -f $WF ]]; then
  echo "FAIL  $WF exists"
  echo
  echo "1 failure(s) — the CI workflow does not exist yet."
  exit 1
fi

# --- triggers: the checks must fire on PRs (the merge gate) and on main ----
PUSH_BLOCK=$(awk '
  /^[^ ]/ { p = 0 }
  /^  push:/ { p = 1; next }
  p { print }
' "$WF")

check "runs on pull_request (so its checks gate PR merges)" \
  grep -Eq '^  pull_request:' "$WF"
check "push trigger targets main" grep -qw 'main' <<<"$PUSH_BLOCK"

# --- integration job ---------------------------------------------------------
INT=$(job_block integration)
check "defines an integration job" test -n "$INT"
check "integration: installs the committed lockfile (npm ci)" \
  grep -q 'npm ci' <<<"$INT"
check "integration: starts the local Supabase stack" \
  grep -q 'supabase start' <<<"$INT"
check "integration: runs supabase/tests/flows.sh" \
  grep -q 'supabase/tests/flows.sh' <<<"$INT"
check "integration: runs independently (no needs)" no_needs "$INT"

# --- playwright job -------------------------------------------------------------
PW=$(job_block playwright)
check "defines a playwright job" test -n "$PW"
check "playwright: installs the committed lockfile (npm ci)" \
  grep -q 'npm ci' <<<"$PW"
check "playwright: starts the local Supabase stack" \
  grep -q 'supabase start' <<<"$PW"
check "playwright: runs npx playwright test" \
  grep -q 'npx playwright test' <<<"$PW"
check "playwright: runs independently (no needs)" no_needs "$PW"

echo
if [[ $FAILURES -gt 0 ]]; then
  echo "$FAILURES failure(s) — CI workflow contract not met."
  exit 1
fi
echo "All checks passed."
