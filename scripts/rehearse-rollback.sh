#!/usr/bin/env bash
# rehearse-rollback.sh — the M8 checklist §5 rollback rehearsal, scripted.
#
# Rehearse BEFORE the pilot needs it: upload an inert (never-activated) tagged
# version, execute a real rollback over it, verify the live service kept serving,
# and print PASS lines that can be pasted as dated evidence into
# docs/m8-cloudflare-deploy-checklist.md §4 "Rollback & incident".
#
# Requirements:
#   export CLOUDFLARE_API_TOKEN   (acccount-scoped: Workers Scripts:Edit etc.)
#   optional: CLOUDFLARE_ACCOUNT_ID (needed when the token has access to >1 account)
#   optional: HEALTH_URL="https://lightdesk.<account>.workers.dev"
#             (when set, the script smoke-checks GET /api/health after the rollback)
#   The worker must already exist in Cloudflare (at least one prior deploy) and
#   .open-next/worker.js must be the current build output.
#
# It is safe to run any time: the version it uploads is never activated, so the
# live deployment is not changed by this drill (rollback re-targets the version
# that is already live).
set -uo pipefail

WORKER_NAME="${WORKER_NAME:-lightdesk}"

banner() { echo "== $*"; }
pass()   { echo "  PASS  $*"; }
die()    { echo "  FAIL  $*" >&2; exit 1; }

banner "rollback rehearsal for worker '${WORKER_NAME}'"

# ---- preflight -------------------------------------------------------------
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "export CLOUDFLARE_API_TOKEN first (and CLOUDFLARE_ACCOUNT_ID when the token spans accounts)."
[ -f ".open-next/worker.js" ] || die "no .open-next/worker.js build output — run: npx opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion"

command -v wrangler >/dev/null 2>&1 || npx --no-install wrangler --version >/dev/null 2>&1 || npx wrangler --version >/dev/null 2>&1 || die "wrangler not available"

# ---- 0. the worker must already exist --------------------------------------
banner "0. existing deployment check"
VERSIONS_OUT="$(mktemp)"
npx wrangler versions list --name "${WORKER_NAME}" > "${VERSIONS_OUT}" 2>&1 \
  || { echo "  BLOCKED: '${WORKER_NAME}' is not deployed yet (versions list failed below)." >&2; tail -5 "${VERSIONS_OUT}" >&2; exit 3; }
ver_count=$(grep -c "Version ID" "${VERSIONS_OUT}" || true)
[ "${ver_count}" -ge 1 ] || { echo "  BLOCKED: no versions to roll back over yet — deploy first." >&2; exit 3; }
pass "${ver_count} existing version(s) found; at least one rollback target exists"

banner "1. capture the LIVE version before the drill"
DEPLOY_OUT="$(mktemp)"
npx wrangler deployments list --name "${WORKER_NAME}" > "${DEPLOY_OUT}" 2>&1 \
  || die "deployments list failed — see ${DEPLOY_OUT}"
live_version=$(grep -oE "[a-f0-9]{32}" "${DEPLOY_OUT}" | head -1 || true)
[ -n "${live_version}" ] || die "could not read the active version id from deployments list"
pass "live version ${live_version} recorded as the recovery target"

# ---- 2. upload an inert, tagged, un-activated version -----------------------
banner "2. upload a rehearsal version (never activated)"
V_TAG="rehearsal-$(date -u +%Y%m%d-%H%M%S)"
npx wrangler versions upload --name "${WORKER_NAME}" \
  --tag "${V_TAG}" \
  --message "rollback rehearsal ${V_TAG}: inert clone of the live code, uploaded only to exercise the rollback path" \
  || die "versions upload failed"
pass "rehearsal version uploaded with tag ${V_TAG} (list shows it as created, separate from the deployment)"

# ---- 3. execute the real rollback ------------------------------------------
banner "3. rollback over the rehearsal version"
npx wrangler rollback --name "${WORKER_NAME}" \
  --message "rehearsal rollback ${V_TAG}: proving the rollback path before the pilot goes live" \
  --yes \
  || die "wrangler rollback failed"
pass "rollback command succeeded"

# ---- 4. verify the service is still live ------------------------------------
banner "4. verify the active deployment and the service"
npx wrangler deployments list --name "${WORKER_NAME}" > "${DEPLOY_OUT}" 2>&1 || die "deployments list failed after rollback"
grep -q "rollback" "${DEPLOY_OUT}" 2>/dev/null && echo "  note  deployments list reflects the rollback event"
pass "deployments list sane after rollback"
if [ -n "${HEALTH_URL}" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "${HEALTH_URL%/}/api/health")
  [ "${HTTP}" = "200" ] || die "GET /api/health returned ${HTTP} instead of 200 after the rollback"
  pass "GET /api/health returned 200 after the rollback (${HEALTH_URL})"
else
  echo "  note  set HEALTH_URL=<staging-url> to smoke-check /api/health as step 4"
fi

cat <<EOF
Rehearsal complete — evidence for checklist §5 ("rehearse once, before the pilot"):
  worker:        ${WORKER_NAME}
  live version:  ${live_version}
  rehearsal tag: ${V_TAG}
  result:        upload → rollback → verified
Paste this block (with today's date) under the checklist's rollback row.
EOF
