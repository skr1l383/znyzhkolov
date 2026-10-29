#!/usr/bin/env bash
# Щоденна резервна копія бази (cron, о 04:00): узгоджена копія SQLite навіть під час роботи сайту.
# Зберігаються останні 14 копій у /var/lib/znyzhkolov/backups.
set -euo pipefail
DIR=/var/lib/znyzhkolov
sqlite3 "$DIR/data/znyzhkolov.db" ".backup '$DIR/backups/znyzhkolov-$(date +%F).db'"
ls -1t "$DIR"/backups/znyzhkolov-*.db | tail -n +15 | xargs -r rm --
