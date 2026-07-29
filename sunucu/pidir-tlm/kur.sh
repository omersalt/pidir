#!/bin/sh
# Pidır telemetri ucunu bisiler kutusunda (Hetzner Swarm) ayağa kaldırır.
# Sunucuda /opt/pidir-tlm içinde çalıştırılır.
#
# Traefik yönlendirmesi bilerek AUTH'SUZ: bisiler.com'un tamamı BasicAuth arkasında,
# ama telemetri paketini gönderen istemcilerin kimliği yok. Aynı gerekçeyle
# `*/feed*` router'ları da auth'suz (bkz. bisiler notları). priority=1000 ile
# genel bisiler router'ının önüne geçer.
set -e

docker build -t pidir-tlm:latest /opt/pidir-tlm

if docker service inspect pidir-tlm >/dev/null 2>&1; then
  docker service update --image pidir-tlm:latest --force pidir-tlm
else
  docker service create \
    --name pidir-tlm \
    --network dokploy-network \
    --mount type=volume,source=pidir-tlm-data,target=/veri \
    --label 'traefik.enable=true' \
    --label 'traefik.http.routers.pidirtlm.rule=Host(`bisiler.com`) && PathPrefix(`/pidir`)' \
    --label 'traefik.http.routers.pidirtlm.entrypoints=websecure' \
    --label 'traefik.http.routers.pidirtlm.tls.certresolver=letsencrypt' \
    --label 'traefik.http.routers.pidirtlm.priority=1000' \
    --label 'traefik.http.services.pidirtlm.loadbalancer.server.port=8099' \
    pidir-tlm:latest
fi

echo "--- durum ---"
docker service ls --filter name=pidir-tlm --format '{{.Name}} {{.Replicas}}'
