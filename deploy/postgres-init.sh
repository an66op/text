#!/bin/sh
set -eu
runtime_password=$(cat /run/secrets/postgres_password)
case "$runtime_password" in
    ''|*[!0-9a-fA-F]*) printf '%s\n' 'Runtime database password must be hexadecimal.' >&2; exit 1 ;;
esac
if [ "${#runtime_password}" -lt 32 ]; then
    printf '%s\n' 'Runtime database password is too short.' >&2
    exit 1
fi
# psql variables use SQL literal quoting; no secret is interpolated into SQL text.
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=runtime_password="$runtime_password" <<'SQL'
CREATE ROLE gongming WITH LOGIN PASSWORD :'runtime_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE gongming OWNER TO gongming;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO gongming;
SQL
unset runtime_password
