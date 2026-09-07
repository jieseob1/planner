#!/bin/sh
set -eu
# Works in both Docker Compose (127.0.0.11) and Kubernetes without hard-coded cluster IPs.
dns_address=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf)
case "$dns_address" in
  ''|*[!0-9a-fA-F.:]*) echo 'No valid container DNS resolver' >&2; exit 1 ;;
esac
case "$dns_address" in *:*) dns_address="[$dns_address]" ;; esac
sed "s/__NOWLINE_DNS_RESOLVER__/$dns_address/g" /etc/nginx/nginx.conf > /tmp/nowline-nginx.conf
exec nginx -c /tmp/nowline-nginx.conf -g 'daemon off;'
