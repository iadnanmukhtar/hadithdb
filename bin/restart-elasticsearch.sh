#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="elasticsearch"
ES_URL="${ES_URL:-http://localhost:9200}"
CURL_MAX_TIME="${CURL_MAX_TIME:-5}"
# Set to 1 if you want to treat yellow as bad; defaults to 0 for single-node setups.
TREAT_YELLOW_AS_BAD="${TREAT_YELLOW_AS_BAD:-0}"

# Use sudo only when needed so the script works from root's cron without prompting.
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is not available; cannot restart ${SERVICE_NAME}." >&2
  exit 1
fi

get_health_status() {
  local response
  response=$(curl -fsSL --max-time "${CURL_MAX_TIME}" "${ES_URL}/_cluster/health" 2>/dev/null) || return 1
  echo "${response}" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*' | head -n 1 | cut -d'"' -f4
}

needs_restart=0
reason=""

if ! ${SUDO} systemctl is-active --quiet "${SERVICE_NAME}"; then
  needs_restart=1
  reason="service is not active"
else
  health_status=$(get_health_status || true)

  if [[ -z "${health_status}" ]]; then
    needs_restart=1
    reason="health check unreachable (service likely stuck)"
  elif [[ "${health_status}" == "red" ]]; then
    needs_restart=1
    reason="cluster health is red"
  elif [[ "${health_status}" == "yellow" && "${TREAT_YELLOW_AS_BAD}" == "1" ]]; then
    needs_restart=1
    reason="cluster health is yellow (treated as bad)"
  fi
fi

if [[ "${needs_restart}" -eq 0 ]]; then
  echo "Elasticsearch healthy (${health_status:-unknown}); skipping restart."
  exit 0
fi

echo "Restarting ${SERVICE_NAME} via systemctl because ${reason}..."
${SUDO} systemctl restart "${SERVICE_NAME}"

# Verify the service came back up.
if ${SUDO} systemctl is-active --quiet "${SERVICE_NAME}"; then
  post_health=$(get_health_status || true)
  echo "${SERVICE_NAME} is active after restart; cluster health=${post_health:-unknown}."
else
  echo "Restart failed; ${SERVICE_NAME} is not active." >&2
  exit 1
fi
