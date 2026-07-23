"""
OTIA — Cliente de Integração IXC
Arroba Banda Larga | NOC

Autenticação: Basic Auth com token IXC (formato id:hash)
Codificado em Base64 conforme padrão IXC REST API
"""

import os
import requests
import json
import base64
from datetime import datetime

# ─── Credenciais ─────────────────────────────────────────────────────────────
IXC_URL   = os.environ.get("IXC_URL", "https://central.arrobabandalarga.com.br/webservice/v1").rstrip("/")
IXC_TOKEN = os.environ.get("IXC_TOKEN", "514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81")

_TOKEN_B64 = base64.b64encode(IXC_TOKEN.encode()).decode()

HEADERS = {
    "Authorization": f"Basic {_TOKEN_B64}",
    "Content-Type":  "application/json",
    "Accept":        "application/json",
    "ixcsoft":       "listar",
}

TIMEOUT = 20

# ─── Base ────────────────────────────────────────────────────────────────────

def _post_list(endpoint: str, payload: dict) -> dict:
    url = f"{IXC_URL}/{endpoint.lstrip('/')}"
    r = requests.post(url, headers=HEADERS, json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()

def _get(endpoint: str) -> dict:
    url = f"{IXC_URL}/{endpoint.lstrip('/')}"
    h = dict(HEADERS)
    h.pop("ixcsoft", None)
    r = requests.get(url, headers=h, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()

def _put(endpoint: str, payload: dict) -> dict:
    url = f"{IXC_URL}/{endpoint.lstrip('/')}"
    h = dict(HEADERS)
    h["ixcsoft"] = "alterar"
    r = requests.put(url, headers=h, json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()

# ─── Teste ───────────────────────────────────────────────────────────────────

def testar_conexao() -> dict:
    try:
        resp = _post_list("su_oss_chamado", {
            "qtype":"su_oss_chamado.id","query":"","oper":"=",
            "page":"1","rp":"1","sortname":"su_oss_chamado.id","sortorder":"desc"
        })
        total = resp.get("total", 0)
        return {"status": "ok", "total_os": total, "url": IXC_URL}
    except Exception as e:
        return {"status": "erro", "detalhe": str(e)}

# ─── OS ──────────────────────────────────────────────────────────────────────

def listar_os_abertas(limite: int = 50, pagina: int = 1) -> dict:
    return _post_list("su_oss_chamado", {
        "qtype":"su_oss_chamado.status","query":"A","oper":"=",
        "page": str(pagina),"rp": str(limite),
        "sortname":"su_oss_chamado.data_abertura","sortorder":"asc"
    })

def listar_os_por_status(status: str, limite: int = 50) -> dict:
    return _post_list("su_oss_chamado", {
        "qtype":"su_oss_chamado.status","query": status,"oper":"=",
        "page":"1","rp": str(limite),
        "sortname":"su_oss_chamado.data_abertura","sortorder":"asc"
    })

def buscar_os_por_cliente(cliente_id: str, limite: int = 20) -> dict:
    return _post_list("su_oss_chamado", {
        "qtype":"su_oss_chamado.id_cliente","query": cliente_id,"oper":"=",
        "page":"1","rp": str(limite),
        "sortname":"su_oss_chamado.data_abertura","sortorder":"desc"
    })

def buscar_os_por_id(os_id: str) -> dict:
    return _get(f"su_oss_chamado/{os_id}")

def atualizar_status_os(os_id: str, novo_status: str, mensagem: str = "") -> dict:
    return _put(f"su_oss_chamado/{os_id}", {"status": novo_status, "mensagem_tec": mensagem})

def registrar_nota_os(os_id: str, nota: str) -> dict:
    return _post_list("su_oss_chamado_notificacao", {"id_oss": os_id, "mensagem": nota})

# ─── Clientes ────────────────────────────────────────────────────────────────

def buscar_cliente_por_id(cliente_id: str) -> dict:
    return _get(f"cliente/{cliente_id}")

def buscar_cliente_por_cpf(cpf: str) -> dict:
    cpf = cpf.replace(".","").replace("-","")
    return _post_list("cliente", {
        "qtype":"cliente.cnpj_cpf","query": cpf,"oper":"=",
        "page":"1","rp":"5","sortname":"cliente.id","sortorder":"desc"
    })

def listar_clientes_por_bairro(bairro: str, limite: int = 50) -> dict:
    return _post_list("cliente", {
        "qtype":"cliente.bairro","query": bairro,"oper":"like",
        "page":"1","rp": str(limite),"sortname":"cliente.id","sortorder":"desc"
    })

# ─── Tickets ─────────────────────────────────────────────────────────────────

def listar_tickets_abertos(limite: int = 50) -> dict:
    return _post_list("su_ticket", {
        "qtype":"su_ticket.status","query":"A","oper":"=",
        "page":"1","rp": str(limite),
        "sortname":"su_ticket.data_abertura","sortorder":"asc"
    })

# ─── Self-test ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    r = testar_conexao()
    print(json.dumps(r, indent=2, ensure_ascii=False))
