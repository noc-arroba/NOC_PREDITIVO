// API: Monitoramento de Rede FTTH — IXC Provedor
// Hierarquia: OLT/Transmissor → PON → Caixa FTTH → Cliente
// Fontes: radusuarios (status online/offline) + radpop_radio_cliente_fibra (sinal óptico, telemetria, PON real, coordenadas)
// Filtro HARD: apenas OLTs ativas | Validação de coordenadas GPS | Detecção de rompimento

const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');

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

// Bounding box de Campos dos Goytacazes e arredores
const CAMPOS_LAT_MIN = -22.05;
const CAMPOS_LAT_MAX = -21.55;
const CAMPOS_LON_MIN = -41.50;
const CAMPOS_LON_MAX = -41.05;

function coordValida(lat, lon) {
  if (!lat || !lon) return false;
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (isNaN(latNum) || isNaN(lonNum)) return false;
  if (latNum === 0 && lonNum === 0) return false;
  if (latNum === -21.0 && lonNum === -48.0) return false;
  return latNum >= CAMPOS_LAT_MIN && latNum <= CAMPOS_LAT_MAX &&
         lonNum >= CAMPOS_LON_MIN && lonNum <= CAMPOS_LON_MAX;
}

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
      id_pon: String(r.id_pon || ''),
      latitude: r.latitude || '',
      longitude: r.longitude || '',
      id_transmissor: String(r.id_transmissor || '')
    };
  }
  return sinalMap;
}

// Detecta rompimentos em 2 níveis: PON (ae0.XXXX) e CTO (id_caixa_ftth)
// REGRA CRÍTICA: uma fibra atende toda a CTO. Se há 1+ cliente online na CTO,
// a fibra está intacta e os offs são individuais (ONU, drop, energia) — NÃO é rompimento.
// Só é rompimento se TODOS os clientes da CTO estiverem offline.
// PON: 2+ CTOs totalmente offline na mesma PON em janela de 2 min → rompimento de PON
// CTO: TODOS os clientes da CTO offline (2+ clientes) → rompimento de ramal da CTO
function detectarRompimentos(clientes, olts) {
  // 1. Agrupar clientes por CTO+PON (uma fibra atende uma PON, não a CTO inteira)
  // Cada combinação CTO+PON é tratada como uma "célula" independente de fibra
  const ctoPonStats = {}; // key: ctoId|pon
  const ctoStats = {};    // key: ctoId (para lookup rápido de PON dominante)
  for (const c of clientes) {
    const ctoId = String(c.id_caixa_ftth || '0');
    if (ctoId === '0') continue;
    const pon = c.conexao ? (c.conexao.split(':')[0] || c.conexao) : null;
    if (!pon) continue;

    // Agrupamento por CTO+PON
    const cpKey = `${ctoId}|${pon}`;
    if (!ctoPonStats[cpKey]) ctoPonStats[cpKey] = { ctoId, pon, total: 0, online: 0, offline: 0, offlineClients: [] };
    ctoPonStats[cpKey].total++;
    if (c.online === 'S') ctoPonStats[cpKey].online++;
    if (c.online === 'N') {
      ctoPonStats[cpKey].offline++;
      if (c.ultima_conexao_final) ctoPonStats[cpKey].offlineClients.push(c);
    }

    // Agrupamento por CTO (para lookup de PON dominante)
    if (!ctoStats[ctoId]) ctoStats[ctoId] = { pon: null, count: 0 };
    if (!ctoStats[ctoId].pon || ctoPonStats[cpKey].total > ctoStats[ctoId].count) {
      ctoStats[ctoId].pon = pon;
      ctoStats[ctoId].count = ctoPonStats[cpKey].total;
    }
  }

  // 2. Filtrar combinações CTO+PON onde TODOS os clientes da MESMA PON estão offline
  // Regra: fibra atende todos os clientes de uma PON na CTO. Se há 1+ online na mesma PON → fibra ok.
  const ctosFullyOffline = [];
  for (const [cpKey, s] of Object.entries(ctoPonStats)) {
    if (s.total >= 2 && s.online === 0 && s.offline >= 2) {
      ctosFullyOffline.push({ ctoId: s.ctoId, pon: s.pon, ...s });
    }
  }

  // 3. Detectar rompimento de PON: 2+ CTOs totalmente offline na mesma PON em 2 min
  const ponGroups = {};
  for (const cto of ctosFullyOffline) {
    const ponKey = cto.pon;
    if (!ponKey) continue;
    if (!ponGroups[ponKey]) ponGroups[ponKey] = [];
    // Usar a primeira queda de cada CTO como timestamp
    const parsed = cto.offlineClients
      .map(c => { try { const dt = new Date(c.ultima_conexao_final.replace(' ', 'T')); return isNaN(dt.getTime()) ? null : dt; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (parsed.length > 0) ponGroups[ponKey].push({ ctoId: cto.ctoId, dt: parsed[0], nClients: cto.offline });
  }

  const rompimentos = [];
  const rompMap = { pons: {}, ctos: {} };

  // Detectar clusters por PON (2+ CTOs offline na mesma PON em 2 min)
  for (const [pon, ctos] of Object.entries(ponGroups)) {
    if (ctos.length < 2) continue;
    ctos.sort((a, b) => a.dt - b.dt);
    
    let cluster = [ctos[0]];
    for (let i = 1; i < ctos.length; i++) {
      const diff = (ctos[i].dt - cluster[cluster.length - 1].dt) / 1000;
      if (diff <= 120) {
        cluster.push(ctos[i]);
      } else {
        if (cluster.length >= 2) break;
        cluster = [ctos[i]];
      }
    }
    
    if (cluster.length >= 2) {
      // Rompimento de PON — coletar todos os clientes offline das CTOs afetadas
      const allOfflineClients = [];
      for (const c of cluster) {
        // Coletar clientes offline de todas as células CTO+PON desse ctoId na PON afetada
        const relevantCells = Object.values(ctoPonStats).filter(s => s.ctoId === c.ctoId);
        for (const cell of relevantCells) {
          for (const cl of cell.offlineClients) {
            try {
              const dt = new Date(cl.ultima_conexao_final.replace(' ', 'T'));
              if (!isNaN(dt.getTime())) allOfflineClients.push({ dt, client: cl });
            } catch {}
          }
        }
      }
      allOfflineClients.sort((a, b) => a.dt - b.dt);
      const romp = buildRompimento(pon, allOfflineClients, olts, 'pon');
      rompimentos.push(romp);
      rompMap.pons[pon] = romp;
      // Marcar todas as CTOs afetadas
      for (const c of cluster) {
        rompMap.ctos[c.ctoId] = romp;
      }
    }
  }

  // 4. Detectar rompimento de CTO (CTO totalmente offline, não parte de rompimento de PON)
  for (const cto of ctosFullyOffline) {
    if (rompMap.ctos[cto.ctoId]) continue; // Já marcada por rompimento de PON
    
    const parsed = cto.offlineClients
      .map(c => { try { const dt = new Date(c.ultima_conexao_final.replace(' ', 'T')); return isNaN(dt.getTime()) ? null : { dt, client: c }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => a.dt - b.dt);
    
    if (parsed.length >= 2) {
      // Verificar se caíram em janela de 2 min
      const span = (parsed[parsed.length - 1].dt - parsed[0].dt) / 1000;
      if (span <= 120) {
        const romp = buildRompimento(cto.ctoId, parsed, olts, 'cto');
        rompMap.ctos[cto.ctoId] = romp;
      }
    }
  }

  // Ordenar por número de clientes afetados (desc)
  rompimentos.sort((a, b) => b.n_clientes - a.n_clientes);
  return { rompimentos, rompMap };
}

function buildRompimento(key, cluster, olts, nivel = 'pon') {
  const inicio = cluster[0].dt;
  const fim = cluster[cluster.length - 1].dt;
  const deltaSeg = Math.round((fim - inicio) / 1000);
  const first = cluster[0].client;
  const oltId = first.oltId;
  const oltNome = OLTS_ATIVAS[oltId] || 'Desconhecida';

  const ctosSet = new Set(cluster.map(c => c.client.id_caixa_ftth || '').filter(id => id && id !== '0'));
  const ponNumCount = {};
  cluster.forEach(c => { const pid = c.client.pon_num_id || ''; if (pid && pid !== '0') ponNumCount[pid] = (ponNumCount[pid]||0) + 1; });
  const ponNumId = Object.entries(ponNumCount).sort((a,b)=>b[1]-a[1]).map(e=>e[0])[0] || '';
  const ctosAfetadas = Array.from(ctosSet).join(', ');

  // Determinar a PON (sempre do conexao, mesmo para nível CTO)
  const pon = nivel === 'cto' ? (first.conexao ? first.conexao.split(':')[0] || key : key) : key;

  return {
    pon,
    ponNumId,
    oltId,
    oltNome,
    nivel, // 'pon' ou 'cto'
    n_clientes: cluster.length,
    inicio: inicio.toISOString().replace('T', ' ').substring(0, 19),
    fim: fim.toISOString().replace('T', ' ').substring(0, 19),
    delta_seg: deltaSeg,
    bairro: first.bairro || '',
    ctos: ctosAfetadas,
    cto_principal: nivel === 'cto' ? key : (ctosSet.size === 1 ? Array.from(ctosSet)[0] : ''),
    clientes: cluster.map(c => ({
      login: c.client.login,
      bairro: c.client.bairro || '',
      id_caixa: c.client.id_caixa_ftth || '',
      ultima_conexao: c.client.ultima_conexao_final,
      sinal_rx: c.client.sinal_rx || '',
      onu_tipo: c.client.onu_tipo || '',
      causa_ultima_queda: c.client.causa_ultima_queda || ''
    }))
  };
}

// === COORDENADAS REAIS DAS CTOs VIA GOOGLE SHEETS ===
const CTO_SHEETS_URL = "https://docs.google.com/spreadsheets/d/1gYd0pUs19nBz_geph9LHFbFhFKBJEpijxxDaG5qTLig/export?format=csv&gid=568231368";
const fetchCtoCoords = async () => {
  try {
    const resp = await fetch(CTO_SHEETS_URL, { 
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csvText = await resp.text();
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const idIdx = headers.findIndex(h => h.toLowerCase() === 'id');
    const latIdx = headers.findIndex(h => h.toLowerCase() === 'latitude');
    const lonIdx = headers.findIndex(h => h.toLowerCase() === 'longitude');
    const bairroIdx = headers.findIndex(h => h.toLowerCase() === 'bairro');
    const map = {};
    if (idIdx >= 0 && latIdx >= 0 && lonIdx >= 0) {
      for (let i = 1; i < lines.length; i++) {
        const cols = [];
        let cur = '', inQ = false;
        for (const ch of lines[i]) {
          if (ch === '"') inQ = !inQ;
          else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
          else cur += ch;
        }
        cols.push(cur);
        const id = cols[idIdx]?.trim();
        const lat = parseFloat(cols[latIdx]);
        const lon = parseFloat(cols[lonIdx]);
        if (id && !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          map[id] = { lat, lon, bairro: bairroIdx >= 0 ? cols[bairroIdx]?.replace(/"/g, '').trim() : '' };
        }
      }
      console.log(`[CTO Override] ${Object.keys(map).length} CTOs carregadas da planilha`);
    }
    return map;
  } catch(e) {
    console.error('[CTO Override] Erro:', e.message);
    return { "4272": { lat: -21.724574807634, lon: -41.302924306658, bairro: "Parque Santa Rosa" } };
  }
};

async function fetchAllFTTH() {
  const [clientesRaw, sinalMap, CTO_COORDS_OVERRIDE] = await Promise.all([
    fetchIXC('radusuarios', {
      qtype: 'ativo', query: 'S', oper: '=', sortname: 'id_transmissor', sortorder: 'asc'
    }, 5000, 5),
    fetchSinalOptico(),
    fetchCtoCoords()
  ]);

  let sinalBom = 0, sinalAtencao = 0, sinalCritico = 0, comSinal = 0;
  const ctoMap = {};
  const olts = {};
  // Lista plana de clientes para detecção de rompimento
  const clientesPlano = [];
  let stats = { totalClientes: 0, online: 0, offline: 0, outros: 0, transmissoresUnicos: 0, pons: 0, caixas: 0,
    sinalBom: 0, sinalAtencao: 0, sinalCritico: 0, comSinal: 0, ctosComCoord: 0, rompimentos: 0 };

  for (const c of clientesRaw) {
    const idTransm = String(c.id_transmissor || '0');
    if (!OLTS_ATIVAS[idTransm]) continue;
    const conn = c.conexao || '';
    if (conn && !conn.startsWith('ae0')) continue;

    const idPON = String(c.interface_transmissao || '0');
    const idCaixa = String(c.id_caixa_ftth || '0');
    const online = c.online || '';
    const nomeOLT = OLTS_ATIVAS[idTransm];
    const loginId = String(c.id || '');

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
      if (coordValida(sinal.latitude, sinal.longitude)) {
        cto.latSum += parseFloat(sinal.latitude);
        cto.lonSum += parseFloat(sinal.longitude);
        cto.coordCount++;
      }
    }

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
        id: idPON, nome: ponNome,
        conexao: (conn && conn.startsWith('ae0') ? conn : ''),
        ponid_tecnico: sinal.ponid || '',
        slotno: sinal.slotno || '', ponno: sinal.ponno || '',
        caixas: {}, stats: { total: 0, online: 0, offline: 0 }
      };
    }
    if (!olts[idTransm].pons[idPON].caixas[idCaixa]) {
      stats.caixas++;
      olts[idTransm].pons[idPON].caixas[idCaixa] = {
        id: idCaixa, nome: `Caixa ${idCaixa}`, clientes: []
      };
    }

    const clienteData = {
      id: c.id, login: c.login, online, conexao: conn || '',
      ftth_porta: c.ftth_porta || sinal.porta_ftth || '',
      onu_mac: c.onu_mac || sinal.onu_mac || '',
      bairro: c.bairro || '', ip: c.ip || '',
      id_caixa_ftth: String(c.id_caixa_ftth || sinal.id_caixa_ftth || ''),
      pon_num_id: sinal.id_pon || '',
      ultima_conexao_final: c.ultima_conexao_final || '',
      sinal_rx: sinal.sinal_rx || '', sinal_tx: sinal.sinal_tx || '',
      sinal_status: sinalStatus,
      temperatura: sinal.temperatura || '', voltagem: sinal.voltagem || '',
      onu_tipo: sinal.onu_tipo || '', ponid: sinal.ponid || '',
      causa_ultima_queda: sinal.causa_ultima_queda || '', data_sinal: sinal.data_sinal || '',
      latitude: sinal.latitude || '', longitude: sinal.longitude || '',
      oltId: idTransm
    };
    olts[idTransm].pons[idPON].caixas[idCaixa].clientes.push(clienteData);
    clientesPlano.push(clienteData);

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

  // Detectar rompimentos ANTES de construir CTOs para poder marcar cada CTO
  const clientesParaRomp = Object.values(ctoMap).length > 0 ? clientesPlano : [];
  const { rompimentos, rompMap } = detectarRompimentos(clientesParaRomp, olts);
  stats.rompimentos = rompimentos.length;

  // Construir mapa rápido de ctoId -> info do rompimento para lookup O(1)
  const rompCtoLookup = {}; // ctoId -> { pon, nivel, n_clientes, inicio }
  rompimentos.forEach(r => {
    // CTOs listadas no campo 'ctos' (por PON)
    (r.ctos || '').split(',').map(s => s.trim()).filter(Boolean).forEach(cid => {
      if (!rompCtoLookup[cid]) rompCtoLookup[cid] = { pon: r.pon, nivel: r.nivel || 'pon', n_clientes: r.n_clientes, inicio: r.inicio };
    });
    // CTO principal (por CTO, nivel cto)
    if (r.cto_principal && r.cto_principal !== '') {
      rompCtoLookup[r.cto_principal] = { pon: r.pon, nivel: r.nivel || 'cto', n_clientes: r.n_clientes, inicio: r.inicio };
    }
  });
  // Adicionar também do rompMap.ctos (detecção por CTO)
  Object.entries((rompMap.ctos) || {}).forEach(([cid, r]) => {
    rompCtoLookup[cid] = { pon: r.pon, nivel: 'cto', n_clientes: r.n_clientes, inicio: r.inicio };
  });

  // CTOs com coordenadas — override do IXC tem prioridade sobre média de clientes
  const ctos = Object.values(ctoMap).map(cto => {
    const rompInfo = rompCtoLookup[String(cto.id)] || null;
    const override = CTO_COORDS_OVERRIDE[String(cto.id)];
    // Se tem override, usa coordenada real do IXC; senão usa média dos clientes
    const lat = override ? override.lat : (cto.coordCount > 0 ? cto.latSum / cto.coordCount : null);
    const lon = override ? override.lon : (cto.coordCount > 0 ? cto.lonSum / cto.coordCount : null);
    return {
      id: cto.id,
      lat, lon,
      total: cto.total, online: cto.online, offline: cto.offline,
      sinalCritico: cto.sinalCritico, sinalAtencao: cto.sinalAtencao,
      oltNome: cto.oltNome, oltId: cto.oltId, bairro: override ? (override.bairro || cto.bairro) : cto.bairro,
      endereco: override ? override.endereco : null,
      coordReal: !!override,  // true se coordenada veio do IXC (não calculada)
      rompimento: rompInfo
    };
  }).filter(cto => cto.lat !== null && cto.lon !== null);
  stats.ctosComCoord = ctos.length;

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

  const hierarquia = Object.values(OLTS_ATIVAS).map((nome, _idx) => {
    const id = Object.keys(OLTS_ATIVAS).find(k => OLTS_ATIVAS[k] === nome);
    const olt = olts[id];
    if (!olt) return { id, nome, pons: [] };
    return {
      id, nome,
      pons: Object.values(olt.pons).map(pon => ({
        ...pon, caixas: Object.values(pon.caixas)
      }))
    };
  }).filter(olt => olt.pons.length > 0 || olt.id === '81');

  return {
    stats, oltsAtivas: Object.entries(OLTS_ATIVAS).map(([id, nome]) => ({ id, nome })),
    transmissoresUnicos, hierarquia, ctos, rompimentos, rompMap
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
