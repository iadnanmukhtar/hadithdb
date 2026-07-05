#!/usr/bin/env bash
set -euo pipefail

log_file="${1:-/var/log/nginx/hadithunlocked-access.log}"

if [[ ! -r "$log_file" ]]; then
  exec sudo "$0" "$log_file"
fi

printf "status\tip\tuser_agent\trequest\n"
tail -F "$log_file" | awk -F'"' '
{
  split($1, prefix, " ")
  split($3, status_parts, " ")
  status = status_parts[1]
  ip = prefix[1]
  request = $2
  user_agent = $6
  printf "%s\t%s\t%s\t%s\n", status, ip, user_agent, request
  fflush()
}
'
