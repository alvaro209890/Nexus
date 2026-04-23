# Nexus Local Deploy

Arquivos de deploy local para este PC:

- `install-local-services.sh`: cria o ambiente Python do backend, instala ChromaDB e publica as units `nexus-*` no `systemd --user`.
- `setup-tunnel.sh`: cria um tunnel dedicado do Cloudflare para `nexus-api.cursar.space` e habilita a unit `nexus-cloudflared.service`.

Esses arquivos foram desenhados para nao tocar no `~/.cloudflared/config.yml` global nem nas outras units ja existentes no host.
