# NOC PREDITIVO — Monitoramento BGP

## AS264025 — Arroba Banda Larga

Sistema de monitoramento preditivo de roteamento BGP, sessões e rotas.

### Fase 1 — Visibilidade Externa (ativa)
- Monitoramento de 22 prefixos (14 IPv4 + 8 IPv6) via RIPE Stat
- Detecção de hijack de prefixo
- Mapeamento de 27 peers BGP
- Visibilidade global (RIPE RIS collectors)
- Score de saúde BGP (0-100)
- Alertas automatizados

### Fase 2 — VPN + SNMP (planejada)
- Acesso interno via WireGuard/OpenVPN
- SNMP polling de roteadores edge
- Estado de sessões BGP em tempo real
- Contadores de tráfego de uplinks

### Fase 3 — Dashboard + Alertas (planejada)
- Dashboard BGP integrado
- Alertas no WhatsApp (NOC_OTIA)
- Entidades para histórico

### Fase 4 — NOC Preditivo (planejada)
- Detecção de flap de sessão
- Anomalia de prefixos
- Degradação de tráfego preditiva
- Correlação BGP + FTTH
- Score de saúde por peer

### Fase 5 — BMP + Flow (evolução)
- BMP stream em tempo real
- NetFlow/sFlow
- Correlação com RADIUS

## API
- `GET /api/bgp` — Status completo do BGP

## Deploy
Deploy automático na Vercel: https://noc-preditivo.vercel.app
