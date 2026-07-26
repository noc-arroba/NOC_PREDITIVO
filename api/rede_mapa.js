// API: Monitoramento de Rede FTTH — IXC Provedor
// Hierarquia: OLT/Transmissor → PON → Caixa FTTH → Cliente
// Fontes: radusuarios (status online/offline) + radpop_radio_cliente_fibra (sinal óptico, telemetria, PON real, coordenadas)
// Filtro HARD: apenas OLTs ativas

const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');

// OLTs ATIVAS — IDs e nomes reais conforme cadastro IXC
const OLTS_ATIVAS = {
  '64': 'OLT HUAWEI - TRAVESSÃO',
  '69': 'FIBERHOME 2 - CANAÃ',
  '70': 'FIBERHOME - URURAÍ',
  '72': 'FIBERHOME 3 - SÃO JOSE (SEM ANM)',
  '73': 'OLT-1 SANTA ROSA (NOVO POP)',
  '74': 'OLT-2 SANTA ROSA (NOVO POP)',
  '76': 'OLT-3 SANTA ROSA (POP NOVO)',
  '77': 'OLT HUAWEI - PARQUE AURORA',
  '78': 'OLT HUAWEI - NOVA BRASÍLIA',
  '79': 'OLT FIBERHOME - CENTRO',
  '81': 'OLT-NOKIA (TESTE)',
  '82': 'OLT ZTE TITAN - SANTA ROSA'
};

let cache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

async function fetchIXC(tabela, body, rp = 10000, maxPages = 10) {
  const headers = {
    'Authorization': `Basic ${IXC_TOKEN}`,
    'ixcsoft': 'listar',
    'Content-Type': 'application/json'
  };
  let allRecords = [], total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const payload = { ...body, page: String(page), rp: String(rp) };
    const resp = await fetch(`${IXC_URL}/${tabela}`, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!resp.ok) break;
    const data = await resp.json();
    if (!data.registros || data.registros.length === 0) break;
    total = parseInt(data.total || 0);
    for (const reg of data.registros) {
      if (typeof reg === 'string') { try { allRecords.push(JSON.parse(reg)); } catch {} }
      else allRecords.push(reg);
    }
    if (allRecords.length >= total || data.registros.length < rp) break;
  }
  return allRecords;
}

// Indexa radpop_radio_cliente_fibra por id_login para merge com radusuarios
async function fetchSinalOptico() {
  const registros = await fetchIXC('radpop_radio_cliente_fibra', {
    qtype: 'id', query: '0', oper: '>', sortname: 'id', sortorder: 'asc'
  }, 5000, 5);

  const sinalMap = {};
  for (const r of registros) {
    const idLogin = String(r.id_login || '');
    if (!idLogin || idLogin === '0') continue;
    sinalMap[idLogin] = {
      sinal_rx: r.sinal_rx || '',
      sinal_tx: r.sinal_tx || '',
      temperatura: r.temperatura || '',
      voltagem: r.voltagem || '',
      ponid: r.ponid || '',
      slotno: r.slotno || '',
      ponno: r.ponno || '',
      onu_tipo: r.onu_tipo || '',
      onu_mac: r.mac || '',
      causa_ultima_queda: r.causa_ultima_queda || '',
      data_sinal: r.data_sinal || '',
      porta_ftth: r.porta_ftth || '',
      id_caixa_ftth: r.id_caixa_ftth || '',
      latitude: r.latitude || '',
      longitude: r.longitude || '',
      id_transmissor: String(r.id_transmissor || '')
    };
  }
  return sinalMap;
}

async function fetchAllFTTH() {
  // Buscar as duas fontes em paralelo
  const [clientes, sinalMap] = await Promise.all([
    fetchIXC('radusuarios', {
      qtype: 'ativo', query: 'S', oper: '=', sortname: 'id_transmissor', sortorder: 'asc'
    }, 5000, 5),
    fetchSinalOptico()
  ]);

  // Estatísticas de sinal óptico
  let sinalBom = 0, sinalAtencao = 0, sinalCritico = 0, comSinal = 0;

  // Mapa de CTOs com coordenadas (para o mapa)
  const ctoMap = {};

  // Hierarquia: OLT → PON → Caixa → Cliente
  const olts = {};
  let stats = { totalClientes: 0, online: 0, offline: 0, outros: 0, transmissoresUnicos: 0, pons: 0, caixas: 0,
    sinalBom: 0, sinalAtencao: 0, sinalCritico: 0, comSinal: 0 };

  for (const c of clientes) {
    const idTransm = String(c.id_transmissor || '0');
    if (!OLTS_ATIVAS[idTransm]) continue;
    // Só considerar clientes com interface ae0 (evita duplicação)
    const conn = c.conexao || '';
    if (conn && !conn.startsWith('ae0')) continue;

    const idPON = String(c.interface_transmissao || '0');
    const idCaixa = String(c.id_caixa_ftth || '0');
    const online = c.online || '';
    const nomeOLT = OLTS_ATIVAS[idTransm];
    const loginId = String(c.id || '');

    // Merge com dados de sinal óptico
    const sinal = sinalMap[loginId] || {};
    const sinalRx = parseFloat(sinal.sinal_rx) || null;
    let sinalStatus = 'sem_leitura';
    if (sinalRx !== null && sinalRx !== 0) {
      comSinal++;
      if (sinalRx >= -25) { sinalBom++; sinalStatus = 'bom'; }
      else if (sinalRx >= -28) { sinalAtencao++; sinalStatus = 'atencao'; }
      else { sinalCritico++; sinalStatus = 'critico'; }
    }

    // Acumular coordenadas da CTO
    if (idCaixa && idCaixa !== '0') {
      if (!ctoMap[idCaixa]) {
        ctoMap[idCaixa] = {
          id: idCaixa, latSum: 0, lonSum: 0, coordCount: 0,
          total: 0, online: 0, offline: 0, sinalCritico: 0, sinalAtencao: 0,
          oltNome: nomeOLT, oltId: idTransm, bairro: c.bairro || ''
        };
      }
      const cto = ctoMap[idCaixa];
      cto.total++;
      if (online === 'S' || online === 'SS') cto.online++;
      else if (online === 'N') cto.offline++;
      if (sinalStatus === 'critico') cto.sinalCritico++;
      if (sinalStatus === 'atencao') cto.sinalAtencao++;
      if (sinal.latitude && sinal.longitude) {
        const lat = parseFloat(sinal.latitude);
        const lon = parseFloat(sinal.longitude);
        if (lat && lon) { cto.latSum += lat; cto.lonSum += lon; cto.coordCount++; }
      }
    }

    // PON real do ponid (formato: 1-1-12-6 = chassis-slot-pon-onu)
    let ponNome = (conn && conn.startsWith('ae0') ? conn.split(':')[0] : `PON ${idPON}`);
    if (sinal.ponid) {
      const parts = String(sinal.ponid).split('-');
      if (parts.length >= 4) {
        ponNome = `Slot ${parts[2]} / PON ${parts[3]}`;
      }
    }

    if (!olts[idTransm]) {
      olts[idTransm] = { id: idTransm, nome: nomeOLT, pons: {} };
    }
    if (!olts[idTransm].pons[idPON]) {
      stats.pons++;
      olts[idTransm].pons[idPON] = {
        id: idPON,
        nome: ponNome,
        conexao: (conn && conn.startsWith('ae0') ? conn : ''),
        ponid_tecnico: sinal.ponid || '',
        slotno: sinal.slotno || '',
        ponno: sinal.ponno || '',
        caixas: {},
        stats: { total: 0, online: 0, offline: 0 }
      };
    }
    if (!olts[idTransm].pons[idPON].caixas[idCaixa]) {
      stats.caixas++;
      olts[idTransm].pons[idPON].caixas[idCaixa] = {
        id: idCaixa, nome: `Caixa ${idCaixa}`, clientes: []
      };
    }
    olts[idTransm].pons[idPON].caixas[idCaixa].clientes.push({
      id: c.id, login: c.login, online, conexao: conn || '',
      ftth_porta: c.ftth_porta || sinal.porta_ftth || '',
      onu_mac: c.onu_mac || sinal.onu_mac || '',
      bairro: c.bairro || '',
      ip: c.ip || '',
      ultima_conexao_final: c.ultima_conexao_final || '',
      sinal_rx: sinal.sinal_rx || '',
      sinal_tx: sinal.sinal_tx || '',
      sinal_status: sinalStatus,
      temperatura: sinal.temperatura || '',
      voltagem: sinal.voltagem || '',
      onu_tipo: sinal.onu_tipo || '',
      ponid: sinal.ponid || '',
      causa_ultima_queda: sinal.causa_ultima_queda || '',
      data_sinal: sinal.data_sinal || '',
      latitude: sinal.latitude || '',
      longitude: sinal.longitude || ''
    });

    stats.totalClientes++;
    olts[idTransm].pons[idPON].stats.total++;
    if (online === 'S' || online === 'SS') { stats.online++; olts[idTransm].pons[idPON].stats.online++; }
    else if (online === 'N') { stats.offline++; olts[idTransm].pons[idPON].stats.offline++; }
    else stats.outros++;
  }

  stats.sinalBom = sinalBom;
  stats.sinalAtencao = sinalAtencao;
  stats.sinalCritico = sinalCritico;
  stats.comSinal = comSinal;

  // Monta array de CTOs com coordenadas calculadas
  const ctos = Object.values(ctoMap).map(cto => ({
    id: cto.id,
    lat: cto.coordCount > 0 ? cto.latSum / cto.coordCount : null,
    lon: cto.coordCount > 0 ? cto.lonSum / cto.coordCount : null,
    total: cto.total,
    online: cto.online,
    offline: cto.offline,
    sinalCritico: cto.sinalCritico,
    sinalAtencao: cto.sinalAtencao,
    oltNome: cto.oltNome,
    oltId: cto.oltId,
    bairro: cto.bairro
  })).filter(cto => cto.lat !== null && cto.lon !== null);

  // Monta array de OLTs com stats
  const transmissoresUnicos = Object.entries(OLTS_ATIVAS).map(([id, nome]) => {
    const olt = olts[id];
    if (!olt) return { id, nome, total: 0, online: 0, offline: 0, pons: 0, taxa: '0.0', alerta: id !== '81' };
    let on = 0, off = 0, total = 0, pons = 0;
    Object.values(olt.pons).forEach(p => { on += p.stats.online; off += p.stats.offline; total += p.stats.total; pons++; });
    const taxa = total > 0 ? ((on / total) * 100).toFixed(1) : '0.0';
    const alerta = (id !== '81') && (total === 0 || parseFloat(taxa) < 75 || (total > 0 && off === total));
    return { id, nome, total, online: on, offline: off, pons, taxa, alerta };
  });

  stats.transmissoresUnicos = transmissoresUnicos.length;

  // Hierarquia plana: array de OLTs com PONs e caixas
  const hierarquia = Object.values(OLTS_ATIVAS).map((nome, _idx) => {
    const id = Object.keys(OLTS_ATIVAS).find(k => OLTS_ATIVAS[k] === nome);
    const olt = olts[id];
    if (!olt) return { id, nome, pons: [] };
    return {
      id, nome,
      pons: Object.values(olt.pons).map(pon => ({
        ...pon,
        caixas: Object.values(pon.caixas)
      }))
    };
  }).filter(olt => olt.pons.length > 0 || olt.id === '81');

  return {
    stats,
    oltsAtivas: Object.entries(OLTS_ATIVAS).map(([id, nome]) => ({ id, nome })),
    transmissoresUnicos,
    hierarquia,
    ctos
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const now = Date.now();
  if (cache.data && (now - cache.ts) < CACHE_TTL) {
    return res.status(200).json({ ...cache.data, cached: true, cache_age: Math.round((now - cache.ts) / 1000) + 's' });
  }
  try {
    const data = await fetchAllFTTH();
    cache = { data, ts: now };
    res.status(200).json({ ...data, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
