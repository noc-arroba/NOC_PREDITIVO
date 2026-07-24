/**
 * OTIA — Backend Function: Produção Setor 23
 * Busca dados em tempo real do IXC e retorna JSON para o dashboard
 * Arroba Banda Larga | NOC
 */

import base44 from '@base44/sdk';

interface TecnicoProducao {
  os: number;
  exec: number;
  dias: number;
}

interface MesData {
  [tecnico: string]: TecnicoProducao;
}

interface DiaData {
  [data: string]: number;
}

interface ProducaoResponse {
  meses: { [mes: string]: MesData };
  dias_atual: { [tecnico: string]: DiaData };
  tecnicos: string[];
  mes_atual: string;
  total_mes: number;
  atualizado_em: string;
}

// Técnicos do setor 23
const PRINCIPAIS: Record<string, string> = {
  '410': 'Pedro Henrique Pimenta',
  '116': 'Lucas Ferreira da Silva',
  '388': 'Marcos Paulo Siqueira',
  '214': 'Charles Dias Francisco',
  '396': 'Carlos Arthur Siqueira',
  '428': 'Diego Pacheco Rocha'
};

const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = '514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81';
const TOKEN_B64 = Buffer.from(IXC_TOKEN).toString('base64');

const HEADERS = {
  'Authorization': `Basic ${TOKEN_B64}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'ixcsoft': 'listar'
};

async function buscarOS(): Promise<any[]> {
  const todosOS: any[] = [];

  for (let page = 1; page <= 8; page++) {
    const resp = await fetch(`${IXC_URL}/su_oss_chamado`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        qtype: 'su_oss_chamado.setor',
        query: '23',
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

    todosOS.push(...regs);

    // Parar se já passou de janeiro 2026
    const hasOld = regs.some((o: any) => {
      const dt = o.data_abertura || '';
      return '2025' in dt || '2026-01' in dt;
    });
    if (hasOld) break;
  }

  return todosOS;
}

export async function handle(req: Request): Promise<Response> {
  try {
    const todosOS = await buscarOS();

    const meses: { [mes: string]: MesData } = {};
    const diasAtual: { [tecnico: string]: DiaData } = {};

    // Inicializar meses para todos os técnicos
    const tecNomes = Object.values(PRINCIPAIS);

    for (const os of todosOS) {
      const tecId = os.id_tecnico || '0';
      if (!(tecId in PRINCIPAIS)) continue;

      const nome = PRINCIPAIS[tecId];
      const status = os.status || '?';
      const dataAb = os.data_abertura || '';
      const dataFc = os.data_fechamento || '';
      const mes = dataAb.slice(0, 7) || '?';

      if (!meses[mes]) meses[mes] = {};
      if (!meses[mes][nome]) meses[mes][nome] = { os: 0, exec: 0, dias: 0 };

      meses[mes][nome].os += 1;

      if (status === 'F') {
        meses[mes][nome].exec += 1;
        const dia = dataFc.slice(0, 10);
        if (dia && dia !== '0000-00-00') {
          // Contar dias únicos
          const diasSet = (meses[mes][nome] as any)._diasSet || new Set();
          diasSet.add(dia);
          (meses[mes][nome] as any)._diasSet = diasSet;
          meses[mes][nome].dias = diasSet.size;

          // Produção por dia do mês atual
          if (mes === '2026-07') {
            if (!diasAtual[nome]) diasAtual[nome] = {};
            diasAtual[nome][dia] = (diasAtual[nome][dia] || 0) + 1;
          }
        }
      }
    }

    // Limpar campos internos
    for (const mes of Object.keys(meses)) {
      for (const nome of Object.keys(meses[mes])) {
        delete (meses[mes][nome] as any)._diasSet;
      }
    }

    const mesesOrd = Object.keys(meses).sort().reverse();
    const mesAtual = mesesOrd[0] || '2026-07';
    const totalMes = Object.values(meses[mesAtual] || {}).reduce((s, v) => s + v.exec, 0);

    const resposta: ProducaoResponse = {
      meses,
      dias_atual: diasAtual,
      tecnicos: tecNomes,
      mes_atual: mesAtual,
      total_mes: totalMes,
      atualizado_em: new Date().toISOString()
    };

    return new Response(JSON.stringify(resposta), {
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
}
