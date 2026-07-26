import base44 from "npm:@base44/sdk@latest";

const IXC_URL = "https://central.arrobabandalarga.com.br/webservice/v1";
const IXC_TOKEN = "514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81";
const TOKEN_B64 = btoa(IXC_TOKEN);

const HEADERS = {
  "Authorization": `Basic ${TOKEN_B64}`,
  "Content-Type": "application/json",
  "Accept": "application/json",
  "ixcsoft": "listar",
};

async function ixcPost(endpoint: string, body: object): Promise<any> {
  const r = await fetch(`${IXC_URL}/${endpoint}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  return r.json();
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const agora = new Date();

    // 1. OS abertas totais
    const osAbertas = await ixcPost("su_oss_chamado", {
      qtype: "su_oss_chamado.status", query: "A", oper: "=",
      page: "1", rp: "1", sortname: "su_oss_chamado.id", sortorder: "desc"
    });
    const totalOsAbertas = Number(osAbertas.total || 0);

    // 2. OS abertas há mais de 24h (SLA crítico - cliente sem conexão)
    const limite24h = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    const data24h = limite24h.toISOString().replace("T", " ").substring(0, 19);

    const osSla24 = await ixcPost("su_oss_chamado", {
      qtype: "su_oss_chamado.data_abertura", query: data24h, oper: "<=",
      page: "1", rp: "1", sortname: "su_oss_chamado.data_abertura", sortorder: "asc"
    });
    const totalSla24 = Number(osSla24.total || 0);

    // 3. OS abertas há mais de 48h (SLA vencido crítico)
    const limite48h = new Date(agora.getTime() - 48 * 60 * 60 * 1000);
    const data48h = limite48h.toISOString().replace("T", " ").substring(0, 19);

    const osSla48 = await ixcPost("su_oss_chamado", {
      qtype: "su_oss_chamado.data_abertura", query: data48h, oper: "<=",
      page: "1", rp: "1", sortname: "su_oss_chamado.data_abertura", sortorder: "asc"
    });
    const totalSla48 = Number(osSla48.total || 0);

    // 4. OS sem técnico atribuído
    const osSemTecnico = await ixcPost("su_oss_chamado", {
      qtype: "su_oss_chamado.id_tecnico", query: "0", oper: "=",
      page: "1", rp: "1", sortname: "su_oss_chamado.id", sortorder: "desc"
    });
    const totalSemTecnico = Number(osSemTecnico.total || 0);

    // 5. OS abertas hoje
    const hoje = agora.toISOString().substring(0, 10);
    const osHoje = await ixcPost("su_oss_chamado", {
      qtype: "su_oss_chamado.data_abertura", query: hoje, oper: "like",
      page: "1", rp: "1", sortname: "su_oss_chamado.id", sortorder: "desc"
    });
    const totalHoje = Number(osHoje.total || 0);

    // 6. Online agora (Radius)
    const online = await ixcPost("radusuarios", {
      qtype: "radusuarios.online", query: "S", oper: "=",
      page: "1", rp: "1", sortname: "radusuarios.id", sortorder: "desc"
    });
    const totalOnline = Number(online.total || 0);

    const offline = await ixcPost("radusuarios", {
      qtype: "radusuarios.online", query: "N", oper: "=",
      page: "1", rp: "1", sortname: "radusuarios.id", sortorder: "desc"
    });
    const totalOffline = Number(offline.total || 0);
    const totalRadius = totalOnline + totalOffline;
    const pctOnline = totalRadius > 0 ? Math.round((totalOnline / totalRadius) * 100) : 0;

    // 7. Status de rompimentos da rede FTTH
    let rompimentoStatus = { total: 0, detalhes: [] };
    try {
      const redeResp = await fetch("https://manutencao-de-rede.vercel.app/api/rede", {
        signal: AbortSignal.timeout(15000)
      });
      if (redeResp.ok) {
        const redeData = await redeResp.json();
        const rompimentos = redeData.rompimentos || [];
        const ctos = redeData.ctos || [];
        
        // Contar CTOs com todos offline
        const ctosCriticas = ctos.filter(c => c.online === 0 && c.offline >= 2);
        
        rompimentoStatus = {
          total: rompimentos.length,
          ctos_totalmente_offline: ctosCriticas.length,
          detalhes: rompimentos.map(r => ({
            nivel: r.nivel,
            pon: r.pon,
            n_clientes: r.n_clientes,
            inicio: r.inicio,
            bairro: r.bairro || 'N/A'
          })),
          ctos_criticas: ctosCriticas.slice(0, 10).map(c => ({
            id: c.id,
            offline: c.offline,
            bairro: c.bairro || 'N/A',
            olt: c.oltNome || 'N/A'
          }))
        };
      }
    } catch(e) {
      console.error("Erro ao buscar rompimentos:", e.message);
    }

    // Criticidade geral
    let criticidade = "🟢 NORMAL";
    if (totalSla48 > 100 || totalSemTecnico > 200 || rompimentoStatus.total > 0) criticidade = "🔴 CRÍTICA";
    else if (totalSla24 > 200 || totalSemTecnico > 100 || rompimentoStatus.ctos_totalmente_offline > 0) criticidade = "🟠 ALTA";
    else if (totalSla24 > 50) criticidade = "🟡 ATENÇÃO";

    const dataHora = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

    const briefing = {
      data_hora: dataHora,
      criticidade,
      os_abertas_total: totalOsAbertas,
      os_abertas_hoje: totalHoje,
      os_sla_critico_24h: totalSla24,
      os_sla_vencido_48h: totalSla48,
      os_sem_tecnico: totalSemTecnico,
      clientes_online: totalOnline,
      clientes_offline: totalOffline,
      pct_online: pctOnline,
      rompimentos: rompimentoStatus,
    };

    return Response.json({ success: true, briefing });

  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
