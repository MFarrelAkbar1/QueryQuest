# MySQL 8.0 for QueryQuest. Used by docker-compose locally and deployed as-is on Railway.
FROM mysql:8.0

COPY conf/queryquest.cnf /etc/mysql/conf.d/queryquest.cnf
COPY init/ /docker-entrypoint-initdb.d/
# Executable scripts run in their own shell instead of being sourced by the entrypoint.
RUN chmod 0644 /etc/mysql/conf.d/queryquest.cnf && chmod 0755 /docker-entrypoint-initdb.d/*.sh
