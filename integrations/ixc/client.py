"""
OTIA — Cliente de Integração IXC
Arroba Banda Larga | NOC

Autenticação: Bearer Token
Endpoints mapeados:
  - OS abertas
  - Clientes
  - Status/atualização de OS
  - Tickets/incidentes
  - Notificações de OS
"""

import os
import requests
import json
from datetime import datetime

# ─── Credenciais via variáveis de ambiente ───────────────────────────────────
IXC_URL   = os.environ.get("IXC_URL", "").rstrip("/")
IXC_TOKEN = os.environ.get("IXC_TOKEN", "")

HEADERS = {
    "Authorization": f"Bearer {IXC_TOKEN}",
    "Content-Type":  "application/json",
    "Accept":        "application/json",
}

TIMEOUT = 15  # segundos

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get(endpoint: str, params: dict = None) -> dict:
    url = f"{IXC_URL}/{endpoint.lstrip('/')}"
    r = requests.get(url, headers=HEADERS, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()

def _post(endpoint: str, payload: dict) -> dict:
    url = f"{IXC_URL}/{endpoint.lstrip('/')}"
    r = requests.post(url, headers=HEADERS, json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()

def _put(endpoint: str, payload: dict) -> dict:
    url = f"{IXC_URL}/{endpoint.lstrip('/')}"
    r = requests.put(url, headers=HEADERS, json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()

# ─── AUTENTICAÇÃO ─────────────────────────────────────────────────────────────

def testar_conexao() -> dict:
    """Valida se a URL e o token estão corretos."""
    try:
        resp = _get("/token")
        return {"status": "ok", "resposta": resp}
    except Exception as e:
        return {"status": "erro", "detalhe": str(e)}

# ─── ORDENS DE SERVIÇO ────────────────────────────────────────────────────────

def listar_os_abertas(limite: int = 50, pagina: int = 1) -> dict:
    """Lista OS com status em aberto."""
    return _get("/su_oss_chamado", params={
        "qtype":     "su_oss_chamado.status",
        "query":     "A",          # A = Aberto
        "oper":      "=",
        "page":      pagina,
        "rp":        limite,
        "sortname":  "su_oss_chamado.data",
        "sortorder": "asc",
    })

def listar_os_por_status(status: str, limite: int = 50) -> dict:
    """
    status: A=Aberto, E=Em andamento, F=Fechado, C=Cancelado
    """
    return _get("/su_oss_chamado", params={
        "qtype":    "su_oss_chamado.status",
        "query":    status,
        "oper":     "=",
        "rp":       limite,
        "sortname": "su_oss_chamado.data",
        "sortorder":"asc",
    })

def buscar_os_por_id(os_id: str) -> dict:
    """Busca uma OS específica pelo ID."""
    return _get(f"/su_oss_chamado/{os_id}")

def buscar_os_por_cliente(cliente_id: str, limite: int = 20) -> dict:
    """Lista OS de um cliente específico."""
    return _get("/su_oss_chamado", params={
        "qtype":  "su_oss_chamado.id_cliente",
        "query":  cliente_id,
        "oper":   "=",
        "rp":     limite,
    })

def atualizar_status_os(os_id: str, novo_status: str, mensagem: str = "") -> dict:
    """
    Atualiza status de uma OS.
    novo_status: A=Aberto, E=Em andamento, F=Fechado, C=Cancelado
    """
    payload = {
        "status":       novo_status,
        "mensagem_tec": mensagem,
    }
    return _put(f"/su_oss_chamado/{os_id}", payload)

def registrar_nota_os(os_id: str, nota: str, tecnico_id: str = None) -> dict:
    """Registra uma nota/anotação numa OS."""
    payload = {
        "id_oss":    os_id,
        "mensagem":  nota,
    }
    if tecnico_id:
        payload["id_tecnico"] = tecnico_id
    return _post("/su_oss_chamado_notificacao", payload)

# ─── CLIENTES ─────────────────────────────────────────────────────────────────

def buscar_cliente_por_id(cliente_id: str) -> dict:
    return _get(f"/cliente/{cliente_id}")

def buscar_cliente_por_contrato(contrato: str) -> dict:
    return _get("/cliente", params={
        "qtype": "cliente.login",
        "query": contrato,
        "oper":  "=",
    })

def buscar_cliente_por_cpf(cpf: str) -> dict:
    cpf_limpo = cpf.replace(".", "").replace("-", "")
    return _get("/cliente", params={
        "qtype": "cliente.cnpj_cpf",
        "query": cpf_limpo,
        "oper":  "=",
    })

def listar_clientes_por_bairro(bairro: str, limite: int = 100) -> dict:
    return _get("/cliente", params={
        "qtype": "cliente.bairro",
        "query": bairro,
        "oper":  "like",
        "rp":    limite,
    })

# ─── SLA / REINCIDÊNCIA ───────────────────────────────────────────────────────

def os_com_sla_vencendo(horas_limite: int = 4) -> dict:
    """
    Retorna OS abertas — ordenadas por data de abertura ascendente.
    Filtragem de SLA deve ser feita no pós-processamento.
    """
    return listar_os_abertas(limite=200)

def reincidencias_por_cliente(cliente_id: str, dias: int = 30) -> dict:
    """Lista OS do cliente nos últimos N dias para análise de reincidência."""
    return buscar_os_por_cliente(cliente_id, limite=50)

# ─── TICKETS / INCIDENTES ─────────────────────────────────────────────────────

def listar_tickets_abertos(limite: int = 50) -> dict:
    return _get("/su_ticket", params={
        "qtype":    "su_ticket.status",
        "query":    "A",
        "oper":     "=",
        "rp":       limite,
        "sortname": "su_ticket.data_abertura",
        "sortorder":"asc",
    })

def buscar_ticket_por_id(ticket_id: str) -> dict:
    return _get(f"/su_ticket/{ticket_id}")

# ─── DIAGNÓSTICO / TESTE ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("OTIA — Teste de Conexão IXC")
    print(f"URL:   {IXC_URL or '⚠️  NÃO CONFIGURADA'}")
    print(f"Token: {'✅ presente' if IXC_TOKEN else '⚠️  NÃO CONFIGURADO'}")
    print("=" * 55)

    if not IXC_URL or not IXC_TOKEN:
        print("❌ Configure IXC_URL e IXC_TOKEN como secrets antes de testar.")
    else:
        resultado = testar_conexao()
        print(json.dumps(resultado, indent=2, ensure_ascii=False))
