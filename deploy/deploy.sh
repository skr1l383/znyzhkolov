#!/usr/bin/env bash
# Оновлення сайту на сервері одною командою (запускати з папки проєкту на своєму комп'ютері):
#   bash deploy/deploy.sh
# Копіює файли з git (без бази, журналів і .env), перезапускає сайт і перевіряє, що він відповідає.
set -euo pipefail
SERVER="${SERVER:-ubuntu@92.5.39.234}"
KEY="${KEY:-$HOME/.ssh/oracle-znyzhkolov.key}"

git ls-files -z | tar --null -T - -czf - | ssh -i "$KEY" "$SERVER" '
  set -e
  sudo rm -rf /opt/znyzhkolov/app.new && sudo mkdir -p /opt/znyzhkolov/app.new
  sudo tar -xzf - -C /opt/znyzhkolov/app.new
  sudo rm -rf /opt/znyzhkolov/app.old
  if [ -d /opt/znyzhkolov/app ]; then sudo mv /opt/znyzhkolov/app /opt/znyzhkolov/app.old; fi
  sudo mv /opt/znyzhkolov/app.new /opt/znyzhkolov/app
  sudo systemctl restart znyzhkolov
  for i in $(seq 1 20); do curl -fs http://127.0.0.1:3000/api/health >/dev/null && break; sleep 0.5; done
  curl -fs http://127.0.0.1:3000/api/health && echo " — сайт оновлено"
'
