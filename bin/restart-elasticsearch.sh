#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="elasticsearch"

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

echo "Restarting ${SERVICE_NAME} via systemctl..."
${SUDO} systemctl restart "${SERVICE_NAME}"

# Verify the service came back up.
if ${SUDO} systemctl is-active --quiet "${SERVICE_NAME}"; then
  echo "${SERVICE_NAME} is active after restart."
else
  echo "Restart failed; ${SERVICE_NAME} is not active." >&2
  exit 1
fi
