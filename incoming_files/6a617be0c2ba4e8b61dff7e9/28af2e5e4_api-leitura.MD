# Token de API Zabbix — Acesso Somente Leitura

## Acesso

- **URL do Zabbix:** http://143.137.32.8:9090/zabbix
- **Endpoint da API:** http://143.137.32.8:9090/zabbix/api_jsonrpc.php

## Token de API

```
b13c5b0f80464472bbc5ae7ee0a13675849ab8f62cb62bee0a481e3aa6bdd
```

> **Atenção:** este token concede acesso à API no nível de permissões descrito abaixo. Trate-o como uma senha — não compartilhe publicamente, não versione em repositórios de código, e revogue-o na interface do Zabbix (Administração → Usuários → Tokens de API) caso seja exposto.

## Permissões configuradas

| Grupo | Tipo | Permissão |
|---|---|---|
| Todos os grupos | Hosts | Leitura |
| Todos os grupos | Templates | Leitura |

O token está vinculado a um usuário com **Função (Role): Admin role**, **Tipo de usuário: Admin**, mas as permissões efetivas de dados foram restritas a **somente leitura** sobre hosts e templates de todos os grupos. Nenhuma permissão de escrita foi concedida.

Observação da interface do Zabbix: "Permissões devem ser definidas para grupos de usuários apenas" — ou seja, o escopo de leitura acima é herdado do grupo de usuários ao qual esta conta pertence, não de configurações individuais do usuário.

## Como usar o token (autenticação via Bearer)

A partir do Zabbix 6.4+, tokens de API são enviados no cabeçalho `Authorization`, sem necessidade de chamar `user.login`:

```bash
curl --request POST \
  --url 'http://143.137.32.8:9090/zabbix/api_jsonrpc.php' \
  --header 'Content-Type: application/json-rpc' \
  --header 'Authorization: Bearer b43086606cc8e30738c7fea7b2e4ffc2c7cc6c27d81c11832a13c96940d2bc71' \
  --data '{
    "jsonrpc": "2.0",
    "method": "host.get",
    "params": {
      "output": ["hostid", "name"]
    },
    "id": 1
  }'
```

Métodos compatíveis com este token (leitura apenas), por exemplo:

- `host.get` — listar hosts e seus atributos
- `template.get` — listar templates
- `item.get`, `trigger.get`, `history.get` — dados associados aos hosts, se herdados das permissões de host

Chamadas de escrita (`host.create`, `host.update`, `host.delete`, `template.update`, etc.) devem retornar erro de permissão, já que o token é restrito a leitura.

## Documentação oficial da API Zabbix

- Referência geral da API: https://www.zabbix.com/documentation/current/en/manual/api
- Autenticação por token / cabeçalho Bearer: https://www.zabbix.com/documentation/current/en/manual/api#authentication
- Referência de métodos (host, template, item, etc.): https://www.zabbix.com/documentation/current/en/manual/api/reference

> Confirme a versão do Zabbix do cliente para garantir que os métodos e o formato de autenticação acima se aplicam (autenticação via Bearer token requer Zabbix 6.4 ou superior).
