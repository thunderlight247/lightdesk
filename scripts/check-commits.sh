#!/usr/bin/env bash
# check-commits.sh — per-commit gate check ("pre-bisect") for a commit range.
#
# Usage: npm run check:commits [-- <base> <head>]   (defaults: base=HEAD~4, head=HEAD)
#
# For every commit in <base>..<head> (oldest first) this checks the commit out in a
# temporary git worktree, symlinks the current checkout's node_modules into it (only
# safe when package.json and lockfiles are identical across the range — checked),
# and runs the DB-free gates in isolation: typecheck, lint, unit tests.
#
# NOT run per commit: the integration suite. It needs the live test database and a
# prisma client matching every intermediate schema; run `npm run test:integration`
# at head instead (the generated prisma client is forward-compatible across commits,
# so head-verified integration coverage is sound, but a schema regression in an
# intermediate commit would not be caught by it — that is what typecheck covers).
#
# Exit code 0 iff every commit in the range passed all its gates; failing commits
# are printed.
set -uo pipefail

BASE="${1:-HEAD~4}"
HEAD_REF="${2:-HEAD}"

if ! command -v git >/dev/null 2>&1; then echo "git is required" >&2; exit 2; fi
if ! git diff --exit-code "${BASE}..${HEAD_REF}" -- package.json package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml >/dev/null 2>&1; then
  echo "FAIL: package.json/lockfiles differ across ${BASE}..${HEAD_REF}; a shared node_modules would misrepresent dependency state." >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
COMMITS="$(git rev-list --reverse "${BASE}..${HEAD_REF}")"
if [ -z "${COMMITS}" ]; then echo "No commits in ${BASE}..${HEAD_REF}." >&2; exit 2; fi
COUNT="$(git rev-list --count "${BASE}..${HEAD_REF}")"

FAILED=""
trap 'git worktree remove --force "${WT:-/nonexistent}" >/dev/null 2>&1 || true' EXIT

for C in ${COMMITS}; do
  SUBJECT="$(git log -1 --format=%s "${C}")"
  WT="$(mktemp -d /tmp/check-commit-XXXXXX)"
  echo "── $(git log -1 --format=%h "${C}") ${SUBJECT}"
  if ! git worktree add --detach "${WT}" "${C}" >/dev/null 2>&1; then
    echo "   ✗ could not check out" >&2; FAILED="${FAILED} ${C}"; continue
  fi
  ln -s "${ROOT}/node_modules" "${WT}/node_modules"

  LOG="$(mktemp)"
  ( cd "${WT}" && npm run --silent typecheck >"$LOG.tsc" 2>&1 ) && TSC=0 || TSC=1
  ( cd "${WT}" && npm run --silent lint      >"$LOG.lint" 2>&1 ) && LINT=0 || LINT=1
  ( cd "${WT}" && npx vitest run             >"$LOG.vitest" 2>&1 ) && UNIT=0 || UNIT=1

  if [ "${TSC}" = 0 ] && [ "${LINT}" = 0 ] && [ "${UNIT}" = 0 ]; then
    echo "   ✓ typecheck, lint, unit tests"
  else
    echo "   ✗ gates failed (typecheck=${TSC} lint=${LINT} unit=${UNIT}); output:" >&2
    [ "${TSC}" = 1 ] && tail -5 "$LOG.tsc" >&2
    [ "${LINT}" = 1 ] && tail -5 "$LOG.lint" >&2
    [ "${UNIT}" = 1 ] && tail -10 "$LOG.vitest" >&2
    FAILED="${FAILED} ${C}"
  fi

  git worktree remove --force "${WT}" >/dev/null 2>&1 || true
  WT=""
done

if [ -z "${FAILED}" ]; then
  echo "All ${COUNT} commits in ${BASE}..${HEAD_REF} passed the DB-free gates."
  exit 0
fi
echo "Failing commits:${FAILED}" >&2
exit 1
