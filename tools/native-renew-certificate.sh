#!/bin/sh
set -eu
# Installed as a certbot deploy hook; unrelated certificate renewals are ignored.
case "${RENEWED_LINEAGE:-}" in
  /etc/letsencrypt/live/cinegather) ;;
  *) exit 0 ;;
esac
install -o root -g cinegather -m 0640 "$RENEWED_LINEAGE/fullchain.pem" /etc/cinegather/tls/fullchain.pem.new
install -o root -g cinegather -m 0640 "$RENEWED_LINEAGE/privkey.pem" /etc/cinegather/tls/privkey.pem.new
mv /etc/cinegather/tls/fullchain.pem.new /etc/cinegather/tls/fullchain.pem
mv /etc/cinegather/tls/privkey.pem.new /etc/cinegather/tls/privkey.pem
nginx -t
systemctl reload nginx
systemctl try-restart cinegather@livekit.service
