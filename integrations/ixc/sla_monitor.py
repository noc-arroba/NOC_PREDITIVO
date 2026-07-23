"""
OTIA — Monitor de SLA IXC
Arroba Banda Larga | NOC

Analisa OS abertas e classifica por criticidade de SLA.
"""

from datetime import datetime, timedelta
import json
from client import listar_os_abertas, listar_tickets_abertos

# SLAs de referência (em horas)
SLA = {
    "cliente_sem_conexao": 24,
    "demais_tecnicos":     48,
    "assumir_os":          (5/60),       # 5 minutos
    "validar_os":          (15/60),      # 15 minutos
    "retorno_status":      2,
}

CRITICIDADE = {
    "critica": "🔴 CRÍTICA",
    "alta":    "🟠 ALTA",
    "media":   "🟡 MÉDIA",
    "baixa":   "🟢 BAIXA",
}


def calcular_horas_abertas(data_abertura_str: str) -> float:
    """Calcula quantas horas a OS está aberta."""
    try:
        formatos = ["%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]
        for fmt in formatos:
            try:
                dt = datetime.strptime(data_abertura_str, fmt)
                return (datetime.now() - dt).total_seconds() / 3600
            except ValueError:
                continue
        return 0
    except Exception:
        return 0


def classificar_sla(horas: float, sla_horas: float) -> dict:
    """Classifica o SLA com base no tempo decorrido."""
    percentual = (horas / sla_horas) * 100 if sla_horas > 0 else 0
    restante   = sla_horas - horas

    if horas > sla_horas:
        return {"status": "VENCIDO", "criticidade": "critica", "restante_h": round(restante, 2)}
    elif percentual >= 80:
        return {"status": "CRÍTICO", "criticidade": "alta", "restante_h": round(restante, 2)}
    elif percentual >= 50:
        return {"status": "ATENÇÃO", "criticidade": "media", "restante_h": round(restante, 2)}
    else:
        return {"status": "OK",      "criticidade": "baixa", "restante_h": round(restante, 2)}


def analisar_os_abertas() -> list:
    """Busca e classifica todas as OS abertas por SLA."""
    resultado = listar_os_abertas(limite=200)
    registros = resultado.get("registros", [])

    analise = []
    for os in registros:
        data_abertura = os.get("data", os.get("data_abertura", ""))
        horas_abertas = calcular_horas_abertas(data_abertura)

        # Assume SLA de 24h para "sem conexão", 48h para demais
        motivo = (os.get("mensagem", "") or os.get("tipo", "") or "").lower()
        sla_ref = SLA["cliente_sem_conexao"] if "conex" in motivo else SLA["demais_tecnicos"]

        sla_info = classificar_sla(horas_abertas, sla_ref)

        analise.append({
            "id":            os.get("id"),
            "cliente_id":    os.get("id_cliente"),
            "status":        os.get("status"),
            "motivo":        os.get("mensagem", ""),
            "tipo":          os.get("tipo", ""),
            "tecnico":       os.get("id_tecnico", "não atribuído"),
            "data_abertura": data_abertura,
            "horas_abertas": round(horas_abertas, 2),
            "sla_horas":     sla_ref,
            "sla_status":    sla_info["status"],
            "criticidade":   sla_info["criticidade"],
            "sla_restante_h": sla_info["restante_h"],
        })

    # Ordena: vencidas primeiro, depois por horas abertas desc
    analise.sort(key=lambda x: (-1 if x["sla_status"] == "VENCIDO" else 0, -x["horas_abertas"]))
    return analise


def relatorio_sla() -> str:
    """Gera relatório de SLA formatado para o NOC."""
    dados = analisar_os_abertas()
    total = len(dados)
    vencidas  = [d for d in dados if d["sla_status"] == "VENCIDO"]
    criticas  = [d for d in dados if d["criticidade"] == "alta"]
    em_atencao = [d for d in dados if d["criticidade"] == "media"]

    linhas = [
        "=" * 60,
        "OTIA — RELATÓRIO DE SLA | NOC ARROBA BANDA LARGA",
        f"Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
        "=" * 60,
        f"Total de OS abertas : {total}",
        f"🔴 SLA VENCIDO       : {len(vencidas)}",
        f"🟠 CRÍTICO (>80%)    : {len(criticas)}",
        f"🟡 ATENÇÃO (>50%)    : {len(em_atencao)}",
        "=" * 60,
    ]

    if vencidas:
        linhas.append("\n⚠️  OS COM SLA VENCIDO — AÇÃO IMEDIATA:")
        for os in vencidas[:10]:
            linhas.append(
                f"  OS #{os['id']} | Cliente {os['cliente_id']} | "
                f"{os['horas_abertas']}h abertas | Técnico: {os['tecnico']}"
            )

    return "\n".join(linhas)


if __name__ == "__main__":
    print(relatorio_sla())
