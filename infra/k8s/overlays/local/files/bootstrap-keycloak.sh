#!/bin/sh

set -eu

case "${KEYCLOAK_DB_PASSWORD:-}" in
  ''|*[!A-Za-z0-9._-]*)
    echo 'KEYCLOAK_DB_PASSWORD must use 1-128 URL-safe characters.' >&2
    exit 64
    ;;
esac

if [ "${#KEYCLOAK_DB_PASSWORD}" -gt 128 ]; then
  echo 'KEYCLOAK_DB_PASSWORD must use at most 128 characters.' >&2
  exit 64
fi

for attempt in $(seq 1 90); do
  if mysqladmin ping -h "${MYSQL_HOST:-nowline-mysql}" -uroot -p"${MYSQL_ROOT_PASSWORD}" --silent; then
    break
  fi
  if [ "$attempt" -eq 90 ]; then
    echo 'MySQL did not become ready for Keycloak bootstrap.' >&2
    exit 1
  fi
  sleep 2
done

mysql -h "${MYSQL_HOST:-nowline-mysql}" -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS keycloak CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'keycloak'@'%' IDENTIFIED BY '${KEYCLOAK_DB_PASSWORD}';
ALTER USER 'keycloak'@'%' IDENTIFIED BY '${KEYCLOAK_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON keycloak.* TO 'keycloak'@'%';
FLUSH PRIVILEGES;
SQL

echo 'Keycloak MySQL schema and user are ready.'
