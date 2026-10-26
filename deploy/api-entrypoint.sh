#!/bin/sh
set -eu

: "${POSTGRES_PASSWORD_FILE:?POSTGRES_PASSWORD_FILE must point to a Docker secret}"
: "${BOOTSTRAP_ADMIN_PASSWORD_FILE:?BOOTSTRAP_ADMIN_PASSWORD_FILE must point to a Docker secret}"
password=$(cat "$POSTGRES_PASSWORD_FILE")
case "$password" in
    ''|*[!0-9a-fA-F]*) printf '%s\n' 'Database password must be a generated hexadecimal secret.' >&2; exit 1 ;;
esac
if [ "${#password}" -lt 32 ]; then
    printf '%s\n' 'Database password must contain at least 32 hexadecimal characters.' >&2
    exit 1
fi
# Hex generation avoids unsafe URI interpolation and shell expansion of secrets.
export DATABASE_URL="postgres://gongming:${password}@db:5432/gongming?sslmode=disable"
unset password
if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ] || [ -n "${BOOTSTRAP_ADMIN_HANDLE:-}" ]; then
    export BOOTSTRAP_ADMIN_PASSWORD="$(cat "$BOOTSTRAP_ADMIN_PASSWORD_FILE")"
fi
exec /usr/local/bin/gongming-api
