/**
 * OTIA — Backend Function: Produção Equipe NOC
 * Busca OS por id_tecnico (todos os setores) para 6 técnicos
 * Arroba Banda Larga | NOC
 */

const PRINCIPAIS: Record<string, string> = {
  '410': 'Pedro Henrique Pimenta',
  '116': 'Lucas Ferreira da Silva',
  '388': 'Marcos Paulo Siqueira',
  '214': 'Charles Dias Francisco',
  '396': 'Carlos Arthur Siqueira',
  '219': 'Deyvson Marques de Oliveira Dias'
};

const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = '514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81';
const TOKEN_B64 = btoa(IXC_TOKEN);

const HEADERS: Record<string, string> = {
  'Authorization': `Basic ${TOKEN_B64}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'ixcsoft': 'listar'
};

Deno.serve(async (req: Request) => {
  try {
    const meses: Record<string, Record<string, { os: number; exec: number; dias: number }>> = {};
    const diasAtual: Record<string, Record<string, number>> = {};
    const diasSetMap: Record<string, Record<string, Set<string>>> = {};

    for (const [tecId, nome] of Object.entries(PRINCIPAIS)) {
      for (let page = 1; page <= 4; page++) {
        const resp = await fetch(`${IXC_URL}/su_oss_chamado`, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({
            qtype: 'su_oss_chamado.id_tecnico',
            query: tecId,
            oper: '=',
            page: String(page),
            rp: '500',
            sortname: 'su_oss_chamado.id',
            sortorder: 'desc'
          })
        });

        const data: any = await resp.json();
        const regs = data.registros || [];
        if (!regs.length) break;

        for (const os of regs) {
          const status = os.status || '?';
          const dataAb = os.data_abertura || '';
          const dataFc = os.data_fechamento || '';
          const mes = dataAb.slice(0, 7) || '?';

          if (mes < '2026-01') continue;

          if (!meses[mes]) meses[mes] = {};
          if (!diasSetMap[mes]) diasSetMap[mes] = {};
          if (!meses[mes][nome]) meses[mes][nome] = { os: 0, exec: 0, dias: 0 };
          if (!diasSetMap[mes][nome]) diasSetMap[mes][nome] = new Set();

          meses[mes][nome].os += 1;

          if (status === 'F') {
            meses[mes][nome].exec += 1;
            const dia = dataFc.slice(0, 10);
            if (dia && dia !== '0000-00-00') {
              diasSetMap[mes][nome].add(dia);
              meses[mes][nome].dias = diasSetMap[mes][nome].size;
              const mesAtualKey = new Date().toISOString().slice(0, 7);
              if (mes === mesAtualKey) {
                if (!diasAtual[nome]) diasAtual[nome] = {};
                diasAtual[nome][dia] = (diasAtual[nome][dia] || 0) + 1;
              }
            }
          }
        }

        const ultima = regs[regs.length - 1];
        const dtUltima = (ultima.data_abertura || '').slice(0, 7);
        if (dtUltima < '2026-01') break;
      }
    }

    const mesesOrd = Object.keys(meses).sort().reverse();
    const mesAtual = mesesOrd[0] || new Date().toISOString().slice(0, 7);
    const totalMes = Object.values(meses[mesAtual] || {}).reduce((s, v) => s + v.exec, 0);

    return new Response(JSON.stringify({
      meses,
      dias_atual: diasAtual,
      tecnicos: Object.values(PRINCIPAIS),
      mes_atual: mesAtual,
      total_mes: totalMes,
      atualizado_em: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      erro: err.message || 'Erro ao buscar dados do IXC',
      atualizado_em: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});
