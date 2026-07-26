// ============================================================
// NOC PREDITIVO — API de Monitoramento BGP (AS264025)
// Fase 1: Visibilidade externa (sem VPN/SNMP)
// ============================================================

const ASN_ARROBA = '264025';

const PREFIXOS_V4 = [
  '143.137.32.0/22', '143.137.32.0/23', '143.137.32.0/24',
  '143.137.33.0/24', '143.137.34.0/23', '143.137.34.0/24',
  '143.137.35.0/24', '168.197.56.0/22', '168.197.56.0/23',
  '168.197.56.0/24', '168.197.57.0/24', '168.197.58.0/23',
  '168.197.58.0/24', '168.197.59.0/24'
];

const PREFIXOS_V6 = [
  '2804:299c::/32', '2804:299c::/33', '2804:299c:8000::/33',
  '2804:299c:1300::/40', '2804:299c:1400::/40',
  '2804:299c:1500::/40', '2804:299c:7e00::/40',
  '2804:299c:7f00::/40'
];

let cache = { data: null, ts: 0 };
const CACHE_TTL = 60000;

const PEERS_CONHECIDOS = {
  '268696': { nome: 'Tuddo Telecom Ltda.', tipo: 'upstream_nacional', prioridade: 1 },
  '263009': { nome: 'Forte Telecom Ltda.', tipo: 'upstream_nacional', prioridade: 2 },
  '6939':   { nome: 'Hurricane Electric LLC', tipo: 'transit_internacional', prioridade: 3 },
  '264596': { nome: 'Alfa Telecomunicacoes', tipo: 'upstream_nacional', prioridade: 4 },
  '137409': { nome: 'GSL Networks Pty LTD', tipo: 'transit_internacional', prioridade: 5 },
  '35280':  { nome: 'F5 Networks SARL', tipo: 'transit_internacional', prioridade: 6 },
  '14840':  { nome: 'BR.Digital Telecom', tipo: 'upstream_nacional', prioridade: 7 },
  '22548':  { nome: 'NIC.BR (IX.br)', tipo: 'ix_ptt', prioridade: 8 },
  '6057':   { nome: 'ANTEL (Uruguai)', tipo: 'peer_regional', prioridade: 9 },
};

async function fetchJSON(url, timeout = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function checkPrefixos() {
  const resultados = [];
  for (const prefix of PREFIXOS_V4) {
    try {
      const data = await fetchJSON(`https://stat.ripe.net/data/prefix-overview/data.json?resource=${prefix}`);
      const block = data.data || {};
      const asns = block.asns || [];
      const announcing = block.announced || false;
      const numIps = block.num_ips || 0;
      let originAsn = asns.length > 0 ? String(asns[0].asn) : null;
      let originHolder = asns.length > 0 ? asns[0].holder : null;
      const isOurs = originAsn === ASN_ARROBA;
      const isHijack = !isOurs && announcing;
      resultados.push({
        prefix, tipo: 'IPv4', anunciado: announcing,
        origin_asn: originAsn, origin_holder: originHolder,
        num_ips: numIps,
        status: isOurs ? 'ok' : (isHijack ? 'HIJACK' : (announcing ? 'terceiro' : 'nao_anunciado')),
        alerta: isHijack || (!announcing && PREFIXOS_V4.indexOf(prefix) < 8)
      });
    } catch (e) {
      resultados.push({ prefix, tipo: 'IPv4', erro: e.message, status: 'erro' });
    }
  }
  for (const prefix of PREFIXOS_V6) {
    try {
      const data = await fetchJSON(`https://stat.ripe.net/data/prefix-overview/data.json?resource=${prefix}`);
      const block = data.data || {};
      const asns = block.asns || [];
      const announcing = block.announced || false;
      let originAsn = asns.length > 0 ? String(asns[0].asn) : null;
      let originHolder = asns.length > 0 ? asns[0].holder : null;
      const isOurs = originAsn === ASN_ARROBA;
      const isHijack = !isOurs && announcing;
      resultados.push({
        prefix, tipo: 'IPv6', anunciado: announcing,
        origin_asn: originAsn, origin_holder: originHolder,
        status: isOurs ? 'ok' : (isHijack ? 'HIJACK' : (announcing ? 'terceiro' : 'nao_anunciado')),
        alerta: isHijack
      });
    } catch (e) {
      resultados.push({ prefix, tipo: 'IPv6', erro: e.message, status: 'erro' });
    }
  }
  return resultados;
}

async function checkPeers() {
  try {
    const data = await fetchJSON(`https://stat.ripe.net/data/asn-neighbours/data.json?resource=AS${ASN_ARROBA}`);
    const neighbours = (data.data || {}).neighbours || [];
    const peers = neighbours.map(n => {
      const info = PEERS_CONHECIDOS[String(n.asn)] || {};
      return {
        asn: n.asn, power: n.power || 0,
        nome: info.nome || `AS${n.asn}`,
        tipo: info.tipo || 'desconhecido',
        prioridade: info.prioridade || 99,
        status: 'ativo'
      };
    }).sort((a, b) => b.power - a.power);
    return peers;
  } catch (e) {
    return [{ erro: e.message }];
  }
}

async function checkVisibilidade() {
  const principais = ['143.137.32.0/22', '168.197.56.0/22', '2804:299c::/32'];
  const resultados = [];
  for (const prefix of principais) {
    try {
      const data = await fetchJSON(`https://stat.ripe.net/data/visibility/data.json?resource=${prefix}`);
      const vis = data.data || {};
      const v4 = vis.ipv4 || {};
      const v6 = vis.ipv6 || {};
      resultados.push({
        prefix,
        rrcs_visible: v4.rrcs_visible || v6.rrcs_visible || 0,
        rrcs_total: v4.rrcs_total || v6.rrcs_total || 0,
        asns_visible: v4.asns_visible || v6.asns_visible || 0,
        status: 'ok'
      });
    } catch (e) {
      resultados.push({ prefix, erro: e.message, status: 'erro' });
    }
  }
  return resultados;
}

async function checkASOverview() {
  try {
    const data = await fetchJSON(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${ASN_ARROBA}`);
    const d = data.data || {};
    return {
      asn: ASN_ARROBA,
      holder: d.holder || 'Arroba Banda Larga',
      announced_prefixes: d.announced_prefixes || 22,
      bgp_peers: 27
    };
  } catch (e) {
    return { erro: e.message };
  }
}

const MTR_TARGETS = [
  { nome: 'Google DNS', ip: '8.8.8.8', tipo: 'dns' },
  { nome: 'Cloudflare DNS', ip: '1.1.1.1', tipo: 'dns' },
  { nome: 'NAS Arroba 1', ip: '143.137.32.3', tipo: 'infra' },
  { nome: 'IXC Central', ip: '143.137.32.7', tipo: 'infra' },
  { nome: 'Bloco 168.197.56', ip: '168.197.56.1', tipo: 'infra' },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const now = Date.now();
  if (cache.data && (now - cache.ts) < CACHE_TTL) {
    return res.json({ ...cache.data, cached: true });
  }
  
  try {
    const [prefixos, peers, visibilidade, overview] = await Promise.all([
      checkPrefixos(), checkPeers(), checkVisibilidade(), checkASOverview()
    ]);
    
    const prefixosOk = prefixos.filter(p => p.status === 'ok').length;
    const prefixosHijack = prefixos.filter(p => p.status === 'HIJACK').length;
    const prefixosNaoAnunciado = prefixos.filter(p => p.status === 'nao_anunciado').length;
    const peersUpstreams = peers.filter(p => p.tipo && p.tipo.includes('upstream'));
    const peersTransit = peers.filter(p => p.tipo && p.tipo.includes('transit'));
    const peersIX = peers.filter(p => p.tipo && p.tipo.includes('ix'));
    
    const scorePrefixos = (prefixosOk / prefixos.length) * 100;
    const scoreHijack = prefixosHijack > 0 ? 0 : 100;
    const scorePeers = peers.length > 0 ? Math.min(100, (peers.length / 27) * 100) : 0;
    const score = Math.round((scorePrefixos * 0.5 + scoreHijack * 0.3 + scorePeers * 0.2));
    
    const alertas = [];
    if (prefixosHijack > 0) alertas.push({ severity: 'critico', msg: `${prefixosHijack} prefixo(s) com possivel HIJACK` });
    if (prefixosNaoAnunciado > 0) alertas.push({ severity: 'critico', msg: `${prefixosNaoAnunciado} prefixo(s) nao anunciado(s)` });
    if (peers.length < 20) alertas.push({ severity: 'atencao', msg: `Apenas ${peers.length} peers ativos (esperado: 27)` });
    
    const result = {
      timestamp: new Date().toISOString(),
      asn: ASN_ARROBA,
      overview,
      score_bgp: score,
      stats: {
        total_prefixos: prefixos.length,
        prefixos_ok: prefixosOk,
        prefixos_hijack: prefixosHijack,
        prefixos_nao_anunciado: prefixosNaoAnunciado,
        total_peers: peers.length,
        peers_upstream: peersUpstreams.length,
        peers_transit: peersTransit.length,
        peers_ix: peersIX.length
      },
      prefixos, peers, visibilidade, alertas,
      mtr_targets: MTR_TARGETS,
      fase: 'Fase 1 - Visibilidade Externa',
      proxima_fase: 'Fase 2 - VPN + SNMP (aguardando credenciais)'
    };
    
    cache = { data: result, ts: now };
    res.json({ ...result, cached: false });
  } catch (error) {
    res.status(500).json({ erro: error.message, asn: ASN_ARROBA });
  }
};
