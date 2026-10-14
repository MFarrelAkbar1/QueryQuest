#!/bin/bash
# Runs once, on first start with an empty data directory.
# Creates the runner's admin account with the minimum privileges it needs:
#   - CREATE USER (a global privilege in MySQL; it covers CREATE/DROP USER only)
#   - data + DDL privileges WITH GRANT OPTION, but only on databases named qq_tmp_*
# No ALL ON *.*, no GRANT OPTION on *.*, no FILE, PROCESS, SUPER or CONNECTION_ADMIN.
# root keeps SYSTEM_USER, so the admin account cannot modify root.
set -euo pipefail

: "${RUNNER_ADMIN_USER:=qq_admin}"
: "${RUNNER_ADMIN_PASSWORD:?RUNNER_ADMIN_PASSWORD must be set}"

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS '${RUNNER_ADMIN_USER}'@'%' IDENTIFIED BY '${RUNNER_ADMIN_PASSWORD}';
GRANT CREATE USER ON *.* TO '${RUNNER_ADMIN_USER}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES
  ON \`qq\_tmp\_%\`.* TO '${RUNNER_ADMIN_USER}'@'%' WITH GRANT OPTION;
SQL

echo "QueryQuest: created runner admin account '${RUNNER_ADMIN_USER}'"
