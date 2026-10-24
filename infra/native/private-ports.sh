#!/bin/sh
set -eu
# LiveKit Prometheus and Ingress HTTP/health/relay listeners are not configurable as loopback listeners.
# Only these project-owned ports are affected; existing firewall rules stay intact.
for CG_TABLES in iptables ip6tables; do
  command -v "$CG_TABLES" >/dev/null 2>&1 || continue
  case "${1:-}" in
    start)
      "$CG_TABLES" -C INPUT ! -i lo -p tcp -m multiport --dports 6789,8085,8086,9095 -j REJECT --reject-with tcp-reset 2>/dev/null ||
        "$CG_TABLES" -I INPUT 1 ! -i lo -p tcp -m multiport --dports 6789,8085,8086,9095 -j REJECT --reject-with tcp-reset
      ;;
    stop)
      if "$CG_TABLES" -C INPUT ! -i lo -p tcp -m multiport --dports 6789,8085,8086,9095 -j REJECT --reject-with tcp-reset 2>/dev/null; then
        "$CG_TABLES" -D INPUT ! -i lo -p tcp -m multiport --dports 6789,8085,8086,9095 -j REJECT --reject-with tcp-reset
      fi
      ;;
    *) echo "Usage: private-ports.sh start|stop" >&2; exit 1 ;;
  esac
done
