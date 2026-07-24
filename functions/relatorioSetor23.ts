/**
 * OTIA — Relatório Diário Setor 23 (Manutenção Cliente) + Setor 104 (Melhoria Cliente)
 * Busca no IXC: OS abertas (status A) + OS fechadas no dia
 * Arroba Banda Larga | NOC
 */

const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = '514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81';
const TOKEN_B64 = btoa(IXC_TOKEN);

const HEADERS: Record<string, string> = {
  'Authorization': `Basic ${TOKEN_B64}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'ixcsoft': 'listar'
};

const TECNICOS: Record<string, string> = {
  '410': 'Pedro Henrique',
  '116': 'Lucas Ferreira',
  '388': 'Marcos Paulo',
  '214': 'Charles Dias',
  '396': 'Carlos Arthur',
  '219': 'Deyvson'
};

const SETORES: Record<string, string> = {
  '23': 'Manutenção Cliente',
  '104': 'Melhoria Cliente'
};

async function ixcPost(endpoint: string, body: object): Promise<any> {
  const r = await fetch(`${IXC_URL}/${endpoint}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body)
  });
  return r.json();
}

async function buscarOsSetor(setorId: string, hojeStr: string, agora: Date) {
  // Buscar OS abertas (status A) do setor
  const abertas: any[] = [];
  const vistos = new Set<number>();

  for (let page = 1; page <= 5; page++) {
    const resp = await ixcPost('su_oss_chamado', {
      qtype: 'su_oss_chamado.setor', query: setorId, oper: '=',
      page: String(page), rp: '500',
      sortname: 'su_oss_chamado.data_abertura', sortorder: 'desc'
    });
    const regs = resp.registros || [];
    if (!regs.length) break;

    for (const os of regs) {
      if (os.status === 'A' && !vistos.has(Number(os.id))) {
        vistos.add(Number(os.id));
        abertas.push(os);
      }
    }
    if (regs.length < 500) break;
  }

  let abertasHoje = 0, abertasOntem = 0, abertasAntigas = 0;
  let slaVencido = 0, slaCritico = 0, slaOk = 0;
  let semTecnico = 0;
  const porTecnicoAbertas: Record<string, number> = {};
  const abertasHojeLista: any[] = [];

  const limite24h = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  const limite80pct = new Date(agora.getTime() - 19.2 * 60 * 60 * 1000);

  for (const os of abertas) {
    const dataAb = (os.data_abertura || '').slice(0, 10);
    if (dataAb === hojeStr) {
      abertasHoje++;
      abertasHojeLista.push({
        id: os.id,
        cliente: os.id_cliente,
        bairro: os.bairro || '',
        data_abertura: os.data_abertura,
        tecnico: TECNICOS[String(os.id_tecnico)] || (os.id_tecnico && os.id_tecnico !== '0' ? `Tec ${os.id_tecnico}` : 'Sem tecnico')
      });
    } else if (dataAb === new Date(agora.getTime() - 86400000).toISOString().slice(0, 10)) {
      abertasOntem++;
    } else {
      abertasAntigas++;
    }

    if (os.data_abertura) {
      const dt = new Date(os.data_abertura.replace(' ', 'T'));
      if (dt < limite24h) slaVencido++;
      else if (dt < limite80pct) slaCritico++;
      else slaOk++;
    }

    const tec = String(os.id_tecnico || '0');
    if (tec === '0' || !tec) {
      semTecnico++;
    } else {
      const nome = TECNICOS[tec] || `Tec ${tec}`;
      porTecnicoAbertas[nome] = (porTecnicoAbertas[nome] || 0) + 1;
    }
  }

  // Buscar OS fechadas hoje do setor
  const fechadas: any[] = [];
  const vistosFc = new Set<number>();

  for (let page = 1; page <= 5; page++) {
    const resp = await ixcPost('su_oss_chamado', {
      qtype: 'su_oss_chamado.setor', query: setorId, oper: '=',
      page: String(page), rp: '500',
      sortname: 'su_oss_chamado.data_fechamento', sortorder: 'desc'
    });
    const regs = resp.registros || [];
    if (!regs.length) break;

    for (const os of regs) {
      const dataFc = (os.data_fechamento || '').slice(0, 10);
      if (dataFc === hojeStr && !vistosFc.has(Number(os.id))) {
        vistosFc.add(Number(os.id));
        fechadas.push(os);
      }
    }

    const algumaHoje = regs.some((r: any) => (r.data_fechamento || '').slice(0, 10) === hojeStr);
    if (!algumaHoje && page > 1) break;
    if (regs.length < 500) break;
  }

  let fcSemTecnico = 0;
  const fcPorTecnico: Record<string, number> = {};
  const fcPorRegiao: Record<string, number> = {};
  const fechadasLista: any[] = [];

  for (const os of fechadas) {
    const tec = String(os.id_tecnico || '0');
    const nomeTec = tec === '0' || !tec ? 'Sem tecnico' : (TECNICOS[tec] || `Tec ${tec}`);
    if (tec === '0' || !tec) fcSemTecnico++;
    else fcPorTecnico[nomeTec] = (fcPorTecnico[nomeTec] || 0) + 1;

    const bairro = (os.bairro || 'Sem bairro').trim();
    fcPorRegiao[bairro] = (fcPorRegiao[bairro] || 0) + 1;

    fechadasLista.push({
      id: os.id,
      cliente: os.id_cliente,
      bairro: os.bairro || '',
      tecnico: nomeTec,
      data_fechamento: os.data_fechamento
    });
  }

  const saldo = fechadas.length - abertasHoje;

  return {
    setor_id: setorId,
    setor_nome: SETORES[setorId] || `Setor ${setorId}`,
    resumo: {
      total_abertas: abertas.length,
      abertas_hoje: abertasHoje,
      abertas_ontem: abertasOntem,
      abertas_antigas: abertasAntigas,
      fechadas_hoje: fechadas.length,
      saldo_dia: saldo,
      sem_tecnico: semTecnico
    },
    sla: { vencido: slaVencido, critico: slaCritico, ok: slaOk },
    abertas_hoje_detalhe: abertasHojeLista,
    fechadas_hoje_detalhe: fechadasLista,
    por_tecnico_abertas: porTecnicoAbertas,
    por_tecnico_fechadas: fcPorTecnico,
    por_regiao_fechadas: fcPorRegiao,
    fechadas_sem_tecnico: fcSemTecnico
  };
}

Deno.serve(async (req: Request) => {
  try {
    const agora = new Date();
    const hojeStr = agora.toISOString().slice(0, 10);
    const dataHora = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // Buscar dados de cada setor
    const setoresResult: any[] = [];
    for (const setorId of Object.keys(SETORES)) {
      const dados = await buscarOsSetor(setorId, hojeStr, agora);
      setoresResult.push(dados);
    }

    // Calcular totais combinados
    const totais = {
      total_abertas: setoresResult.reduce((s, r) => s + r.resumo.total_abertas, 0),
      abertas_hoje: setoresResult.reduce((s, r) => s + r.resumo.abertas_hoje, 0),
      abertas_ontem: setoresResult.reduce((s, r) => s + r.resumo.abertas_ontem, 0),
      abertas_antigas: setoresResult.reduce((s, r) => s + r.resumo.abertas_antigas, 0),
      fechadas_hoje: setoresResult.reduce((s, r) => s + r.resumo.fechadas_hoje, 0),
      sem_tecnico: setoresResult.reduce((s, r) => s + r.resumo.sem_tecnico, 0),
      sla_vencido: setoresResult.reduce((s, r) => s + r.sla.vencido, 0),
      sla_critico: setoresResult.reduce((s, r) => s + r.sla.critico, 0),
      sla_ok: setoresResult.reduce((s, r) => s + r.sla.ok, 0)
    };

    return new Response(JSON.stringify({
      success: true,
      data_hora: dataHora,
      setores: setoresResult,
      totais
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message || 'Erro ao buscar dados do IXC'
    }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
});
