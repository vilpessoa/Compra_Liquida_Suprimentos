#!/usr/bin/env bash
# Copia os repositórios oficiais da RFB para conformance/work, gera o banco SQLite,
# compila (-DskipTests) e sobe as duas APIs em background (perfil offline).
#
# Variáveis obrigatórias:
#   JAVA_HOME          JDK 25
#   RFB_REGIME_SRC     checkout de calculadora-rtc-regime-regular (somente leitura)
#   RFB_SN_SRC         checkout de calculadora-rtc-simples-nacional (somente leitura)
# Portas fixas (as dos application-offline.yml oficiais):
#   regime-regular  http://localhost:8080/api   (management 9101)
#   simples         http://localhost:8082/api   (management 9103)
set -euo pipefail
: "${JAVA_HOME:?defina JAVA_HOME (JDK 25)}"
: "${RFB_REGIME_SRC:?defina RFB_REGIME_SRC}"
: "${RFB_SN_SRC:?defina RFB_SN_SRC}"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$HERE/work"
RR="$WORK/regime-regular"
SN="$WORK/simples-nacional"
mkdir -p "$WORK/logs"

copy_repo() { # src dst
  if [ ! -d "$2" ]; then
    mkdir -p "$2"
    tar -C "$1" --exclude=./.git --exclude=./target --exclude=./calculadora -cf - . | tar -C "$2" -xf -
  fi
}
copy_repo "$RFB_REGIME_SRC" "$RR"
copy_repo "$RFB_SN_SRC" "$SN"
# README do Simples: o banco é gerado com a pasta flyway/ do regime-regular.
[ -d "$SN/flyway" ] || cp -r "$RR/flyway" "$SN/flyway"

gen_db() { # dir
  ( cd "$1"
    mkdir -p ./calculadora/db
    if [ ! -s ./calculadora/db/calculadora-pro.db ]; then
      ./mvnw flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf --batch-mode --errors
    fi
    ls -lah ./calculadora/db/calculadora-pro.db )
}
gen_db "$RR"
gen_db "$SN"

build() { # dir
  ( cd "$1"; ./mvnw clean package -DskipTests --batch-mode --errors ) 
}
build "$RR"
build "$SN"

wait_health() { # name url mgmtport
  for i in $(seq 1 120); do
    if curl -fsS "http://localhost:$3/health" 2>/dev/null | grep -q '"UP"'; then echo "$1 UP"; return 0; fi
    sleep 2
  done
  echo "ERRO: $1 não ficou saudável; veja $WORK/logs" >&2; return 1
}

start() { # name dir jar mgmt
  if curl -fsS "http://localhost:$4/health" >/dev/null 2>&1; then echo "$1 já está de pé"; return; fi
  ( cd "$2"
    nohup java -Dspring.profiles.active=offline -jar "target/$3" > "$WORK/logs/$1.log" 2>&1 &
    echo $! > "$WORK/$1.pid" )
}
start regime-regular "$RR" api-regime-geral.jar 9101
start simples "$SN" api-simples-nacional.jar 9103
wait_health regime-regular x 9101
wait_health simples x 9103
echo "OK: regime-regular http://localhost:8080/api | simples http://localhost:8082/api"
