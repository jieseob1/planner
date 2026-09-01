# PostgreSQL legacy data migration

This one-time tool preserves data from the former PostgreSQL runtime while the
application itself runs only on MySQL 8.4. It refuses to write when the target
`app_user` table is non-empty, imports inside one transaction, excludes MySQL
generated columns, and compares every table count plus a planner fingerprint.

Before running it, keep a separate `pg_dump -Fc` backup, start the legacy
PostgreSQL container read-only from the retained volume, start a freshly
migrated MySQL container, and stop every backend writer. Then run:

```bash
NOWLINE_LEGACY_POSTGRES_CONTAINER=nowline-local-postgres-1 \
NOWLINE_MYSQL_CONTAINER=nowline-local-mysql-1 \
NOWLINE_MYSQL_PASSWORD=nowline-local-only \
node scripts/legacy-data-migration/migrate-postgresql-to-mysql.mjs
```

Do not delete the PostgreSQL volume or its dump after a successful import.
Keep both until the MySQL backup/restore drill and application QA pass.

For the local Kubernetes PVCs, keep both database Pods running and select the
transport explicitly:

```bash
NOWLINE_LEGACY_POSTGRES_K8S_POD=nowline-postgres-0 \
NOWLINE_MYSQL_K8S_POD=nowline-mysql-0 \
NOWLINE_MIGRATION_K8S_NAMESPACE=nowline-local \
NOWLINE_MYSQL_PASSWORD=nowline-local-only \
node scripts/legacy-data-migration/migrate-postgresql-to-mysql.mjs
```
