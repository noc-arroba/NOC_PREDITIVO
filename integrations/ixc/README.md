# Integração IXC — OTIA NOC

## Escopo
- Consultar OS abertas
- Consultar clientes
- Consultar/atualizar status de OS
- Monitorar SLA vencendo
- Consultar alarmes / incidentes
- Automação de dados (relatório/dashboard)

## Variáveis de ambiente necessárias
- IXC_URL → URL base da API (ex: https://empresa.ixcprovedor.com.br/webservice/v1)
- IXC_TOKEN → Token Bearer gerado no painel IXC

## Endpoints principais mapeados
- /su_oss_chamado → OS (ordens de serviço)
- /cliente → Dados de clientes
- /su_oss_chamado_tipo → Tipos de OS
- /su_oss_chamado_status → Status de OS
- /su_ticket → Tickets / incidentes
- /su_oss_chamado_notificacao → Notificações de OS
