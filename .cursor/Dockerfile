# Cloud Agent base image for the Farm OS monorepo.
#
# Provides the two stable system toolchains the repo needs:
#   * Node.js 22 (matches packages/ui/.nvmrc and every CI job)
#   * PostgreSQL 17 + pgTAP — for the Docker-free DB test shim
#     (apps/farm-os/supabase/test-shims/run-pgtap-local.sh), which is the
#     authoritative automated DB gate in CI (db-tests.yml).
#
# Repository dependencies (npm workspaces) are installed later by the
# environment `install` step against the checked-out source — not baked here.
FROM node:22-bookworm

# PostgreSQL 17 + pgTAP from the official PGDG apt repository.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -sSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-17 postgresql-17-pgtap; \
    rm -rf /var/lib/apt/lists/*

# Put the PostgreSQL 17 binaries (initdb, pg_ctl, psql, ...) on PATH so the
# pgTAP shim discovers them via `command -v initdb`.
ENV PATH="/usr/lib/postgresql/17/bin:${PATH}"

USER node
