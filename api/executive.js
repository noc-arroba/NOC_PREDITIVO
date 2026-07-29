// ============================================================
// NOC PREDITIVO — API Executiva
// Agrega BGP + Zabbix + Flow + Medições Ativas
// Health Score consolidado da infraestrutura
// ============================================================

const FLOW_BASE = 'https://lvflow-conectti.lv.network';
const FLOW_TOKEN = '8OEHA-R5hLuuOerVPZ3HqdfCehlNF3ngOayQVGq7T1M';
const ZABBIX_URL = 'http://143.137.32.8:9090/zabbix/api_jsonrpc.php';
const ZABBIX_TOKEN = 'b43086606cc8e30738c7fea7b2e4ffc2c7cc6c27d81c11832a13c96940d2bc71';
const ASN = '264025';
const RIPE_BASE = 'https://stat.ripe.net/data';

const SOURCES = ['ANB-BRAS01-MX204-CENTRO', 'ANB-BRAS02-MX204-STA-ROSA', 'ANB-TH4430-A10-CGNAT-01'];

// Alvos de medição ativa
const PING_TARGETS = [
  { name: 'Google DNS', ip: '8.8.8.8', tipo: 'dns', criticidade: 'alta' },
  { name: 'Cloudflare DNS', ip: '1.1.1.1', tipo: 'dns', criticidade: 'alta' },
  { name: 'MX204 Centro', ip: '143.137.32.3', tipo: 'infra', criticidade: 'critica' },
  { name: 'MX204 Sta Rosa', ip: '143.137.32.4', tipo: 'infra', criticidade: 'critica' },
  { name: 'CCR Santa Rosa', ip: '143.137.32.6', tipo: 'infra', criticidade: 'critica' },
  { name: 'RB Cliente', ip: '100.65.0.116', tipo: 'cliente', criticidade: 'alta' },
  { name: 'IXC Central', ip: '143.137.32.7', tipo: 'sistema', criticidade: 'alta' },
  { name: 'BR Digital', ip: '200.160.253.1', tipo: 'upstream', criticidade: 'media' },
];

// Topologia conhecida
const TOPOLOGY = {
  core: [
    { nome: 'MX204 Centro', ip: '143.137.32.3', funcao: 'BGP Router / PPPoE BRAS', modelo: 'Juniper MX204', zabbix: 'MX 204 - PPPOE1' },
    { nome: 'MX204 Sta Rosa', ip: '143.137.32.4', funcao: 'BGP Router / PPPoE BRAS', modelo: 'Juniper MX204', zabbix: 'MX 204 - PPPOE2' },
    { nome: 'CCR Santa Rosa', ip: '143.137.32.6', funcao: 'Servidor VPN L2TP', modelo: 'Mikrotik CCR', zabbix: 'CCR SERVER_SANTA ROSA' },
    { nome: 'CCR Centro 1', ip: '143.137.32.8', funcao: 'NAS / PPPoE', modelo: 'Mikrotik CCR 1072', zabbix: 'CCR SERVER 1072' },
    { nome: 'CCR Centro 2', ip: '143.137.32.7', funcao: 'NAS / PPPoE', modelo: 'Mikrotik CCR 1036', zabbix: 'CCR SERVER 1036' },
    { nome: 'A10 CGNAT', ip: '143.137.32.5', funcao: 'CGNAT / NAT64', modelo: 'A10 Thunder', zabbix: null },
  ],
  pop: [
    { nome: 'POP Centro', ip: '143.137.32.3', tipo: 'Fibra', olt: 79 },
    { nome: 'POP Santa Rosa', ip: '143.137.32.4', tipo: 'Fibra', olt: '73/74/76' },
    { nome: 'POP Canã', ip: null, tipo: 'Fibra', olt: 69 },
    { nome: 'POP Ururaí', ip: null, tipo: 'Fibra', olt: 70 },
    { nome: 'POP São José', ip: null, tipo: 'Fibra', olt: 72 },
    { nome: 'POP Aurora', ip: null, tipo: 'Fibra', olt: 77 },
    { nome: 'POP Nova Brasília', ip: null, tipo: 'Fibra', olt: 78 },
    { nome: 'POP Travessão', ip: null, tipo: 'Fibra', olt: 64 },
    { nome: 'POP Titan', ip: null, tipo: 'Fibra', olt: 82 },
  ],
  upstreams: [
    { asn: '6939', nome: 'Hurricane Electric', tipo: 'transit_internacional' },
    { asn: '14840', nome: 'BR.Digital', tipo: 'upstream_nacional' },
    { asn: '268696', nome: 'Tuddo Telecom', tipo: 'upstream_nacional' },
    { asn: '263009', nome: 'Forte Telecom', tipo: 'upstream_nacional' },
    { asn: '22548', nome: 'NIC.BR (IX.br)', tipo: 'ix_ptt' },
  ]
};

let cache = { data: null, ts: 0 };
const CACHE_TTL = 30000; // 30 segundos

async function fetchJSON(url, timeout = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally { clearTimeout(t); }
}

async function zabbixCall(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const res = await fetch(ZABBIX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json-rpc', 'Authorization': 'Bearer ' + ZABBIX_TOKEN },
    body,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.data || data.error.message);
  return data.result;
}

async function flowAPI(endpoint, params = {}) {
  const url = new URL(`${FLOW_BASE}/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${FLOW_TOKEN}` } });
  if (!res.ok) throw new Error(`Flow API ${endpoint}: ${res.status}`);
  return res.json();
}

function fmtBps(bps) {
  if (bps >= 1e9) return (bps / 1e9).toFixed(1) + ' Gbps';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(1) + ' Kbps';
  return bps.toFixed(0) + ' bps';
}

function calcJitter(rtts) {
  if (rtts.length < 2) return 0;
  const diffs = [];
  for (let i = 1; i < rtts.length; i++) diffs.push(Math.abs(rtts[i] - rtts[i-1]));
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

async function getZabbixData() {
  try {
    const [hosts, triggers] = await Promise.all([
      zabbixCall('host.get', {
        output: ['hostid', 'name', 'status'],
        selectInterfaces: ['ip', 'available', 'error'],
        filter: { status: 0 }
      }),
      zabbixCall('trigger.get', {
        output: ['triggerid', 'description', 'priority', 'value', 'lastchange'],
        selectHosts: ['name', 'hostid'],
        filter: { value: 1 },
        sortfield: 'lastchange', sortorder: 'DESC', limit: 50
      })
    ]);

    const now = Date.now() / 1000;
    let hostsOk = 0, hostsDown = 0, hostsUnknown = 0;
    const infraHosts = {};

    for (const h of hosts) {
      const iface = h.interfaces?.[0];
      if (iface?.available === '1') hostsOk++;
      else if (iface?.available === '2') hostsDown++;
      else hostsUnknown++;

      // Identificar equipamentos de infraestrutura
      const name = h.name.toUpperCase();
      if (name.includes('MX 204') || name.includes('CCR SERVER') || name.includes('BGP') ||
          name.includes('OLT') || name.includes('ENERGIA') || name.includes('TEMPERATURA')) {
        infraHosts[h.name] = {
          ip: iface?.ip,
          available: iface?.available,
          status: iface?.available === '1' ? 'UP' : iface?.available === '2' ? 'DOWN' : 'UNKNOWN'
        };
      }
    }

    const triggersFmt = triggers.map(t => {
      const sev = parseInt(t.priority || 0);
      const ageSec = now - parseInt(t.lastchange || 0);
      let ageTxt;
      if (ageSec < 60) ageTxt = Math.floor(ageSec) + 's';
      else if (ageSec < 3600) ageTxt = Math.floor(ageSec/60) + 'min';
      else if (ageSec < 86400) ageTxt = (ageSec/3600).toFixed(1) + 'h';
      else ageTxt = (ageSec/86400).toFixed(1) + 'd';
      return {
        host: t.hosts?.[0]?.name || 'N/A',
        description: t.description,
        severity: sev,
        severityName: ['NA','INFO','WARN','MED','HIGH','DISAS'][sev] || '?',
        ageTxt,
        lastchange: parseInt(t.lastchange || 0)
      };
    });

    return {
      totalHosts: hosts.length, hostsOk, hostsDown, hostsUnknown,
      totalTriggers: triggers.length,
      triggers: triggersFmt,
      infraHosts
    };
  } catch (e) {
    return { error: e.message, totalHosts: 0, totalTriggers: 0, triggers: [] };
  }
}

async function getBGPData() {
  try {
    const [overview, peers] = await Promise.all([
      fetchJSON(`${RIPE_BASE}/as-overview/data.json?resource=AS${ASN}`),
      fetchJSON(`${RIPE_BASE}/asn-neighbours/data.json?resource=AS${ASN}`)
    ]);

    const neighbours = (peers.data || {}).neighbours || [];
    const activePeers = neighbours.filter(n => n.power > 0);

    // Verificar prefixos principais
    const mainPrefix = '143.137.32.0/22';
    let prefixStatus = null;
    try {
      const pData = await fetchJSON(`${RIPE_BASE}/prefix-overview/data.json?resource=${mainPrefix}`);
      const block = pData.data || {};
      prefixStatus = {
        prefix: mainPrefix,
        announced: block.announced || false,
        origin_asn: block.asns?.[0]?.asn || null,
        origin_holder: block.asns?.[0]?.holder || null
      };
    } catch {}

    return {
      asn: ASN,
      holder: overview.data?.holder || 'Arroba Banda Larga',
      announced_prefixes: overview.data?.announced_prefixes || 22,
      total_peers: neighbours.length,
      active_peers: activePeers.length,
      prefix_status: prefixStatus
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function getFlowData() {
  try {
    const results = await Promise.all(
      SOURCES.map(async (src) => {
        try {
          const data = await flowAPI('traffic-interfaces', { source: src, minutes: 1 });
          const rxInterfaces = data.series?.rx || [];
          const txInterfaces = data.series?.tx || [];
          let rx = 0, tx = 0;
          for (const iface of rxInterfaces) {
            const arr = iface.data?.bps || [];
            rx += arr[arr.length - 1] || 0;
          }
          for (const iface of txInterfaces) {
            const arr = iface.data?.bps || [];
            tx += arr[arr.length - 1] || 0;
          }
          return { source: src, rx, tx, rx_fmt: fmtBps(rx), tx_fmt: fmtBps(tx) };
        } catch { return { source: src, rx: 0, tx: 0, error: true }; }
      })
    );

    const totalRx = results.reduce((s, r) => s + (r.rx || 0), 0);
    const totalTx = results.reduce((s, r) => s + (r.tx || 0), 0);

    return {
      sources: results,
      total_rx: totalRx, total_tx: totalTx,
      total_rx_fmt: fmtBps(totalRx), total_tx_fmt: fmtBps(totalTx)
    };
  } catch (e) {
    return { error: e.message, sources: [] };
  }
}

async function getActiveMeasurements() {
  // Ping nos alvos críticos via Flow server
  const session = await getFlowSession();
  if (!session.cookie) return { error: 'No flow session', results: [] };

  const targets = PING_TARGETS.slice(0, 5); // Top 5 para não estourar timeout
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        const pingResult = await flowPingInternal(session, t.ip, 3);
        return { name: t.name, ip: t.ip, tipo: t.tipo, ...pingResult };
      } catch (e) {
        return { name: t.name, ip: t.ip, tipo: t.tipo, error: e.message, received: 0, loss_pct: 100 };
      }
    })
  );

  return { results };
}

// Funções internas de ping (reutilizadas do flow-proxy)
let flowSessionCache = { cookie: null, csrf: null, ts: 0 };
async function getFlowSession() {
  const now = Date.now();
  if (flowSessionCache.cookie && (now - flowSessionCache.ts) < 600000) return flowSessionCache;

  try {
    const loginRes = await fetch(`${FLOW_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=otia&password=${encodeURIComponent('Arr0b@2019Bl')}`,
      redirect: 'manual'
    });
    const cookie = loginRes.headers.get('set-cookie') || '';
    const sessionCookie = cookie.split(';')[0];
    if (!sessionCookie.includes('session')) throw new Error('Login failed');

    const pageRes = await fetch(`${FLOW_BASE}/admin/ping-traceroute`, {
      headers: { Cookie: sessionCookie }
    });
    const html = await pageRes.text();
    const csrfMatch = html.match(/csrf-token" content="([^"]+)"/);

    flowSessionCache = { cookie: sessionCookie, csrf: csrfMatch?.[1] || '', ts: now };
    return flowSessionCache;
  } catch (e) {
    return { cookie: null, csrf: null };
  }
}

async function flowPingInternal(session, target, count = 3) {
  const url = `${FLOW_BASE}/system-api/ping?ip=${encodeURIComponent(target)}&count=${count}&mtu=1`;
  const res = await fetch(url, {
    headers: { 'Cookie': session.cookie, 'X-CSRFToken': session.csrf }
  });
  if (!res.ok) throw new Error(`Ping ${target}: ${res.status}`);

  const text = await res.text();
  const samples = [];
  for (let i = 0; i < text.length;) {
    const evIdx = text.indexOf('event:', i);
    if (evIdx === -1) break;
    const dataIdx = text.indexOf('data:', evIdx);
    if (dataIdx === -1) break;
    const nextEv = text.indexOf('\nevent:', dataIdx);
    const dataLine = text.slice(dataIdx + 5, nextEv === -1 ? text.length : nextEv).trim();
    const evName = text.slice(evIdx + 6, text.indexOf('\n', evIdx)).trim();
    try {
      const d = JSON.parse(dataLine);
      if (evName === 'sample' && d.rtt_ms != null) samples.push(d.rtt_ms);
    } catch {}
    i = nextEv === -1 ? text.length : nextEv;
  }

  const valid = samples.filter(r => r >= 0);
  const lost = samples.length - valid.length;
  const lossPct = samples.length > 0 ? (lost / samples.length) * 100 : 0;

  return {
    sent: samples.length, received: valid.length, lost,
    loss_pct: Math.round(lossPct * 10) / 10,
    rtt_avg: valid.length > 0 ? Math.round((valid.reduce((a,b) => a+b, 0) / valid.length) * 100) / 100 : 0,
    rtt_min: valid.length > 0 ? Math.round(Math.min(...valid) * 100) / 100 : 0,
    rtt_max: valid.length > 0 ? Math.round(Math.max(...valid) * 100) / 100 : 0,
    jitter: valid.length > 1 ? Math.round(calcJitter(valid) * 100) / 100 : 0
  };
}

// Calcular Health Score consolidado
function calcHealthScore(zabbix, bgp, flow, measurements) {
  let score = 100;
  const factors = [];

  // BGP: 30% do score
  if (bgp && !bgp.error) {
    if (bgp.prefix_status && !bgp.prefix_status.announced) {
      score -= 30;
      factors.push({ area: 'BGP', impact: -30, reason: 'Prefixo principal não anunciado' });
    }
    if (bgp.active_peers < 15) {
      const penalty = (15 - bgp.active_peers) * 1;
      score -= penalty;
      factors.push({ area: 'BGP', impact: -penalty, reason: `Apenas ${bgp.active_peers} peers ativos` });
    }
  }

  // Zabbix: 40% do score
  if (zabbix && !zabbix.error) {
    const criticalTriggers = zabbix.triggers.filter(t => t.severity >= 4).length;
    const highTriggers = zabbix.triggers.filter(t => t.severity === 3).length;
    const downHosts = zabbix.hostsDown;

    if (criticalTriggers > 0) {
      const penalty = Math.min(20, criticalTriggers * 2);
      score -= penalty;
      factors.push({ area: 'Zabbix', impact: -penalty, reason: `${criticalTriggers} triggers críticos` });
    }
    if (highTriggers > 0) {
      const penalty = Math.min(10, highTriggers * 1);
      score -= penalty;
      factors.push({ area: 'Zabbix', impact: -penalty, reason: `${highTriggers} triggers altos` });
    }
    if (downHosts > 0) {
      const penalty = Math.min(10, downHosts * 2);
      score -= penalty;
      factors.push({ area: 'Zabbix', impact: -penalty, reason: `${downHosts} hosts down` });
    }
  }

  // Medições ativas: 20% do score
  if (measurements && measurements.results) {
    const losses = measurements.results.filter(r => r.loss_pct >= 50);
    const highLatency = measurements.results.filter(r => r.rtt_avg > 100);
    if (losses.length > 0) {
      const penalty = Math.min(15, losses.length * 5);
      score -= penalty;
      factors.push({ area: 'Latência', impact: -penalty, reason: `${losses.length} alvos com perda >= 50%` });
    }
    if (highLatency.length > 0) {
      const penalty = Math.min(5, highLatency.length * 2);
      score -= penalty;
      factors.push({ area: 'Latência', impact: -penalty, reason: `${highLatency.length} alvos com latência > 100ms` });
    }
  }

  // Flow: 10% do score
  if (flow && !flow.error && flow.sources) {
    const errors = flow.sources.filter(s => s.error);
    if (errors.length > 0) {
      const penalty = errors.length * 3;
      score -= penalty;
      factors.push({ area: 'Flow', impact: -penalty, reason: `${errors.length} fontes sem dados` });
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let status = 'SAUDÁVEL';
  let color = '#10b981';
  if (score < 50) { status = 'CRÍTICO'; color = '#ef4444'; }
  else if (score < 75) { status = 'ATENÇÃO'; color = '#f59e0b'; }

  return { score, status, color, factors };
}

// Análise preditiva
function analyzeTrends(zabbix, flow) {
  const predictions = [];

  // Análise de tráfego — tendência de crescimento
  if (flow && flow.sources) {
    for (const src of flow.sources) {
      if (src.error) continue;
      // Estimativa simples: se tráfego atual > 80% de um link de 100G, alertar
      const utilizationPct = (src.rx / 100e9) * 100;
      if (utilizationPct > 80) {
        predictions.push({
          tipo: 'saturacao',
          severidade: 'alto',
          equipamento: src.source,
          probabilidade: Math.round(utilizationPct),
          impacto_estimado: `${utilizationPct.toFixed(1)}% de utilização do link`,
          acao: 'Monitorar crescimento e planejar upgrade de capacidade'
        });
      } else if (utilizationPct > 60) {
        predictions.push({
          tipo: 'saturacao',
          severidade: 'atencao',
          equipamento: src.source,
          probabilidade: Math.round(utilizationPct),
          impacto_estimado: `${utilizationPct.toFixed(1)}% de utilização do link`,
          acao: 'Acompanhar tendência de crescimento semanal'
        });
      }
    }
  }

  // Análise de triggers Zabbix — identificar padrões
  if (zabbix && zabbix.triggers) {
    const infraTriggers = zabbix.triggers.filter(t =>
      t.host.toUpperCase().includes('OLT') || t.host.toUpperCase().includes('MX') ||
      t.host.toUpperCase().includes('CCR') || t.host.toUpperCase().includes('BGP')
    );
    for (const t of infraTriggers) {
      if (t.severity >= 4) {
        predictions.push({
          tipo: 'falha_equipamento',
          severidade: 'critico',
          equipamento: t.host,
          probabilidade: 80,
          impacto_estimado: `Trigger ativo: ${t.description}`,
          acao: `Acionamento imediato — verificar ${t.host}`,
          idade: t.ageTxt
        });
      }
    }

    // Detectar múltiplos triggers no mesmo host
    const byHost = {};
    for (const t of zabbix.triggers) {
      byHost[t.host] = (byHost[t.host] || 0) + 1;
    }
    for (const [host, count] of Object.entries(byHost)) {
      if (count >= 3) {
        predictions.push({
          tipo: 'correlacao',
          severidade: 'alto',
          equipamento: host,
          probabilidade: 70,
          impacto_estimado: `${count} triggers ativos simultâneos — possível falha em cascata`,
          acao: `Investigar ${host} como ponto único de falha (SPOF)`
        });
      }
    }
  }

  return predictions;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = Date.now();
  const useCache = !req.query.nocache && cache.data && (now - cache.ts) < CACHE_TTL;
  if (useCache) {
    return res.json({ ...cache.data, cached: true });
  }

  try {
    // Buscar dados em paralelo
    const [zabbix, bgp, flow] = await Promise.all([
      getZabbixData(),
      getBGPData(),
      getFlowData()
    ]);

    // Medições ativas (mais lentas, mas em paralelo)
    let measurements = null;
    if (req.query.include_ping === '1') {
      try { measurements = await getActiveMeasurements(); } catch (e) { measurements = { error: e.message }; }
    }

    // Calcular Health Score
    const health = calcHealthScore(zabbix, bgp, flow, measurements);

    // Análise preditiva
    const predictions = analyzeTrends(zabbix, flow);

    // Alertas inteligentes (agrupados por severidade)
    const alerts = [];
    if (zabbix.triggers) {
      const critTriggers = zabbix.triggers.filter(t => t.severity >= 4);
      const highTriggers = zabbix.triggers.filter(t => t.severity === 3);
      const medTriggers = zabbix.triggers.filter(t => t.severity === 2);

      if (critTriggers.length > 0) {
        alerts.push({
          level: 'critico',
          count: critTriggers.length,
          color: '#ef4444',
          items: critTriggers.slice(0, 10).map(t => ({
            host: t.host,
            description: t.description,
            age: t.ageTxt
          }))
        });
      }
      if (highTriggers.length > 0) {
        alerts.push({
          level: 'alto',
          count: highTriggers.length,
          color: '#f97316',
          items: highTriggers.slice(0, 5).map(t => ({
            host: t.host,
            description: t.description,
            age: t.ageTxt
          }))
        });
      }
      if (medTriggers.length > 0) {
        alerts.push({
          level: 'medio',
          count: medTriggers.length,
          color: '#fbbf24',
          items: medTriggers.slice(0, 3).map(t => ({
            host: t.host,
            description: t.description,
            age: t.ageTxt
          }))
        });
      }
    }

    const result = {
      timestamp: new Date().toISOString(),
      health,
      topology: TOPOLOGY,
      zabbix,
      bgp,
      flow,
      measurements,
      predictions,
      alerts
    };

    cache = { data: result, ts: now };
    return res.json(result);
  } catch (err) {
    console.error('Executive API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
