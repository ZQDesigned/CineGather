#!/bin/sh
set -eu
case "${1:-}" in
  api) exec /usr/local/bin/node apps/api/dist/main.js ;;
  livekit) exec /opt/cinegather/bin/livekit-server --config /etc/cinegather/livekit.yaml ;;
  ingress) exec /opt/cinegather/bin/ingress --config /etc/cinegather/ingress.yaml ;;
  redis) exec /usr/bin/redis-server /etc/cinegather/redis.conf ;;
  *) echo "Unknown CineGather service" >&2; exit 1 ;;
esac
