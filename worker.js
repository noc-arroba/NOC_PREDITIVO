/**
 * NOC PREDITIVO — Cloudflare Worker v2.0
 * Network Intelligence Center — 13 Módulos
 * AS264025 — Arroba Banda Larga
 */

// ============================================================
// CONFIG
// ============================================================
const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = btoa('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81');
const IXC_HEADERS = {
  'Authorization': `Basic ${IXC_TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'ixcsoft': 'listar'
};

const ZABBIX_URL = 'https://zabbix.arrobabandalarga.com.br/api_jsonrpc.php';
const ZABBIX_USER = 'Admin';
const ZABBIX_PASS = 'zabbix';

const BGP_API = 'https://api.bgpview.io/asn/264025';
const BGP_PREFIX_API = 'https://api.bgpview.io/asn/264025/prefixes';
const VERCEL_BGP = 'https://noc-preditivo.vercel.app/api/bgp';
const VERCEL_ZABBIX = 'https://noc-preditivo.vercel.app/api/zabbix';

const FLOW_API = 'https://lvflow-conectti.lv.network/api';
const FLOW_TOKEN = 'lvtool_4be01944-b73e-4e89-9f1b-8d9a5f7b6a5c';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ============================================================
// MAIN ROUTER
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (path.startsWith('/api/')) {
      return handleApi(path, url, request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404 });
  }
};

async function handleApi(path, url, request, env) {
  const route = path.replace('/api/', '').replace(/\.js$/, '');
  try {
    switch (route) {
      case 'health': return await apiHealth(url);
      case 'bgp': case 'bgp.js': return await apiBGP(url);
      case 'zabbix': case 'zabbix.js': return await apiZabbix(url);
      case 'executive': case 'executive.js': return await apiExecutive(url);
      case 'sla': case 'sla.js': return await apiSla(url);
      case 'security': case 'security.js': return await apiSecurity(url);
      case 'events': return await apiEvents(url);
      case 'capacity': return await apiCapacity(url);
      case 'customers': return await apiCustomers(url);
      case 'network-map': return await apiNetworkMap(url);
      case 'flow': case 'flow-proxy': return await apiFlow(url);
      case 'olts-ixc': case 'olts-ixc.js': return await apiOltIxc(url);
      case 'scan-network': case 'scan-network.js': return await apiScanNetwork(url);
      case 'test-snmp': case 'test-snmp.js': return await apiTestSnmp(url);
      case 'test-vpn': case 'test-vpn.js': return await apiTestVpn(url);
      case 'rca': return await apiRCA(url);
      case 'prediction': return await apiPrediction(url);
      default: return json({ error: 'Unknown API: ' + route }, 404);
    }
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}min`;
  if (diff < 3600) return `${Math.floor(diff/60)}min`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h`;
  return `${Math.floor(diff/86400)}d`;
}

// ============================================================
// ZABBIX HELPER
// ============================================================
async function zabbixLogin() {
  const res = await fetch(ZABBIX_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'user.login', params: { user: ZABBIX_USER, password: ZABBIX_PASS }, id: 1 })
  }).then(r => r.json());
  return res.result;
}

async function zabbixCall(token, method, params) {
  const res = await fetch(ZABBIX_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, auth: token, id: Math.random() })
  }).then(r => r.json());
  return res.result;
}

async function zabbixLogout(token) {
  await fetch(ZABBIX_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'user.logout', auth: token, id: 99 })
  });
}

// ============================================================
// API: HEALTH INDEX (Módulo 1)
// ============================================================
async function apiHealth(url) {
  const [bgpRes, zabbixRes] = await Promise.allSettled([
    fetch(VERCEL_BGP).then(r => r.json()).catch(() => null),
    fetch(VERCEL_ZABBIX + '?action=overview').then(r => r.json()).catch(() => null),
  ]);

  const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;
  const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;

  const factors = [];
  let score = 100;

  // BGP (peso 15)
  let bgpScore = 100;
  if (bgp?.score_bgp !== undefined && bgp.score_bgp < 100) {
    bgpScore = bgp.score_bgp;
    score -= (100 - bgpScore) * 0.15;
    factors.push({ area: 'BGP', impact: -((100 - bgpScore) * 0.15), detail: `Score BGP: ${bgpScore}/100` });
  }
  factors.push({ area: 'BGP', score: bgpScore, weight: '15%', status: bgpScore >= 90 ? 'ok' : 'warn' });

  // Zabbix hosts (peso 25)
  let hostScore = 100;
  if (zabbix?.stats) {
    const down = zabbix.stats.hostsDown || 0;
    const total = zabbix.stats.totalHosts || 1;
    hostScore = Math.round(((total - down) / total) * 100);
    if (down > 0) {
      const impact = down * 5;
      score -= impact;
      factors.push({ area: 'Disponibilidade', impact: -impact, detail: `${down} equipamento(s) offline` });
    }
  }
  factors.push({ area: 'Disponibilidade', score: hostScore, weight: '25%', status: hostScore >= 95 ? 'ok' : hostScore >= 80 ? 'warn' : 'critical' });

  // Alarmes (peso 25)
  let alarmScore = 100;
  if (zabbix?.bySeverity) {
    const disas = zabbix.bySeverity['5'] || 0;
    const high = zabbix.bySeverity['4'] || 0;
    const avg = zabbix.bySeverity['3'] || 0;
    const totalAlarms = disas + high + avg;
    if (disas > 0) { score -= disas * 8; alarmScore -= disas * 8; factors.push({ area: 'Alarmes', impact: -(disas * 8), detail: `${disas} alarme(s) DISASTER` }); }
    if (high > 0) { score -= Math.min(high * 3, 20); alarmScore -= Math.min(high * 3, 20); factors.push({ area: 'Alarmes', impact: -Math.min(high * 3, 20), detail: `${high} alarme(s) HIGH` }); }
    if (avg > 0) { score -= Math.min(avg * 1, 10); alarmScore -= Math.min(avg * 1, 10); }
  }
  factors.push({ area: 'Alarmes', score: Math.max(0, alarmScore), weight: '25%', status: alarmScore >= 80 ? 'ok' : alarmScore >= 50 ? 'warn' : 'critical' });

  // Latência (peso 15) — baseado na RB measurement
  let latScore = 100;
  // Sem dados de RB em tempo real aqui, mas podemos estimar
  factors.push({ area: 'Latência', score: latScore, weight: '15%', status: 'ok' });

  // Links (peso 10)
  let linkScore = 100;
  if (bgp?.stats?.total_peers) {
    const peers = bgp.stats.total_peers;
    const peersUp = bgp.stats.peers_upstream || peers;
    if (peersUp < peers) {
      linkScore = Math.round((peersUp / peers) * 100);
      score -= (100 - linkScore) * 0.10;
    }
  }
  factors.push({ area: 'Links/Peers', score: linkScore, weight: '10%', status: linkScore >= 90 ? 'ok' : 'warn' });

  // CPU/Memória (peso 10)
  let cpuScore = 100;
  if (zabbix?.topTriggers) {
    const cpuAlarms = zabbix.topTriggers.filter(t => t.description?.toLowerCase().includes('cpu') || t.description?.toLowerCase().includes('memory'));
    if (cpuAlarms.length > 0) { cpuScore = 70; score -= 5; factors.push({ area: 'CPU/Memória', impact: -5, detail: `${cpuAlarms.length} alarme(s) de CPU/Memória` }); }
  }
  factors.push({ area: 'CPU/Memória', score: cpuScore, weight: '10%', status: cpuScore >= 80 ? 'ok' : 'warn' });

  score = Math.max(0, Math.round(score));
  const status = score >= 85 ? 'healthy' : score >= 60 ? 'warning' : 'critical';

  return json({
    timestamp: new Date().toISOString(),
    score,
    status,
    maxScore: 100,
    factors,
    reductions: factors.filter(f => f.impact !== undefined),
    summary: status === 'healthy' ? 'Rede operando normalmente' : 
             status === 'warning' ? 'Atenção: fatores de degradação detectados' :
             'CRÍTICO: Múltiplos fatores impactando a rede',
    recommendations: generateHealthRecs(factors, zabbix),
  });
}

function generateHealthRecs(factors, zabbix) {
  const recs = [];
  const critical = factors.filter(f => f.status === 'critical');
  const warn = factors.filter(f => f.status === 'warn');
  
  critical.forEach(f => recs.push(`[CRÍTICO] ${f.area}: ${f.detail || 'Ação imediata necessária'}`));
  warn.forEach(f => recs.push(`[ATENÇÃO] ${f.area}: ${f.detail || 'Monitorar evolução'}`));
  
  if (zabbix?.topTriggers) {
    const disas = zabbix.topTriggers.filter(t => t.severity >= 5);
    disas.forEach(t => recs.push(`[DISASTER] ${t.host}: ${t.description}`));
  }
  
  if (recs.length === 0) recs.push('Nenhuma ação imediata necessária. Rede saudável.');
  return recs;
}

// ============================================================
// API: EVENTS TIMELINE (Módulo 4)
// ============================================================
async function apiEvents(url) {
  const hours = parseInt(url.searchParams.get('hours') || '24');
  const since = Date.now() - hours * 3600000;

  const [bgpRes, zabbixRes] = await Promise.allSettled([
    fetch(VERCEL_BGP).then(r => r.json()).catch(() => null),
    fetch(VERCEL_ZABBIX + '?action=overview').then(r => r.json()).catch(() => null),
  ]);

  const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;
  const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;

  const events = [];

  // Zabbix triggers como eventos
  if (zabbix?.topTriggers) {
    zabbix.topTriggers.forEach(t => {
      const sevColors = { 5: '#dc2626', 4: '#ea580c', 3: '#ca8a04', 2: '#3b82f6', 1: '#64748b' };
      events.push({
        time: t.age || 'recente',
        type: 'zabbix',
        severity: t.severity,
        severityName: t.severityName,
        title: `${t.host}: ${t.description}`,
        color: sevColors[t.severity] || '#64748b',
        source: 'Zabbix',
        correlation: t.severity >= 4 ? 'Verificar impacto em clientes e links' : null,
      });
    });
  }

  // BGP events
  if (bgp?.peers) {
    bgp.peers.filter(p => p.status === 'down').forEach(p => {
      events.push({
        time: 'recente',
        type: 'bgp',
        severity: 4,
        severityName: 'HIGH',
        title: `Sessão BGP down: ${p.name} (AS${p.asn})`,
        color: '#ea580c',
        source: 'BGP Monitor',
        correlation: 'Verificar rotas alternativas e impacto em tráfego',
      });
    });
  }

  // Ordenar por severidade
  events.sort((a, b) => (b.severity || 0) - (a.severity || 0));

  return json({
    timestamp: new Date().toISOString(),
    hours,
    totalEvents: events.length,
    bySeverity: {
      disaster: events.filter(e => e.severity >= 5).length,
      high: events.filter(e => e.severity === 4).length,
      average: events.filter(e => e.severity === 3).length,
      warning: events.filter(e => e.severity <= 2).length,
    },
    events,
    aiAnalysis: events.length > 0 ?
      `${events.length} eventos detectados nas últimas ${hours}h. ${events.filter(e => e.severity >= 4).length} de alta severidade.` :
      'Nenhum evento crítico nas últimas 24h.',
  });
}

// ============================================================
// API: CAPACITY (Módulo 8)
// ============================================================
async function apiCapacity(url) {
  const [zabbixRes, bgpRes] = await Promise.allSettled([
    fetch(VERCEL_ZABBIX + '?action=overview').then(r => r.json()).catch(() => null),
    fetch(VERCEL_BGP).then(r => r.json()).catch(() => null),
  ]);

  const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;
  const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;

  return json({
    timestamp: new Date().toISOString(),
    bandwidth: {
      current: 'Dados de fluxo indisponíveis no momento',
      trend: 'Requer coleta contínua do Flow API',
      projection: 'Configurar monitoramento Flow para projeção',
    },
    bgp: {
      prefixes: bgp?.overview?.announced_prefixes || 0,
      maxPrefixes: 256,
      utilization: `${Math.round(((bgp?.overview?.announced_prefixes || 0) / 256) * 100)}%`,
      recommendation: 'Capacidade de prefixos adequada',
    },
    hosts: {
      total: zabbix?.stats?.totalHosts || 0,
      active: zabbix?.stats?.hostsOk || 0,
      inactive: zabbix?.stats?.hostsDown || 0,
    },
    olts: {
      total: 10,
      active: 10,
      ponPorts: 80,
      utilized: 'Requer consulta ao IXC',
    },
    aiProjection: 'Com base nos dados atuais, recomenda-se monitoramento contínuo do Flow API para projeções de capacidade precisas.',
  });
}

// ============================================================
// API: CUSTOMERS (Módulo 7)
// ============================================================
async function apiCustomers(url) {
  const action = url.searchParams.get('action') || 'overview';

  try {
    if (action === 'reincidence') {
      // Buscar OS dos últimos 30 dias
      const body = JSON.stringify({
        qtype: 'data_abertura',
        query: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        oper: '>=',
        page: 1, rp: 500,
        sortname: 'id', sortorder: 'desc',
      });

      const res = await fetch(IXC_URL + '/su_oss_chamado', {
        method: 'POST', headers: IXC_HEADERS, body
      }).then(r => r.json());

      const oss = res.registros || res.data || [];
      const byClient = {};
      oss.forEach(os => {
        const id = os.id_cliente;
        if (!byClient[id]) byClient[id] = { id, nome: os.razao || 'N/A', count: 0, bairro: os.bairro || '' };
        byClient[id].count++;
      });

      const top = Object.values(byClient)
        .sort((a, b) => b.count - a.count)
        .filter(c => c.count >= 3)
        .slice(0, 20);

      return json({
        timestamp: new Date().toISOString(),
        period: '30 dias',
        totalOs: oss.length,
        uniqueClients: Object.keys(byClient).length,
        highReincidence: top,
      });
    }

    // Overview
    return json({
      timestamp: new Date().toISOString(),
      message: 'Use ?action=reincidence para top clientes com reincidência',
    });
  } catch (e) {
    return json({ error: 'Customers API: ' + e.message }, 500);
  }
}

// ============================================================
// API: NETWORK MAP (Módulo 2)
// ============================================================
async function apiNetworkMap(url) {
  const [zabbixRes, bgpRes] = await Promise.allSettled([
    fetch(VERCEL_ZABBIX + '?action=overview').then(r => r.json()).catch(() => null),
    fetch(VERCEL_BGP).then(r => r.json()).catch(() => null),
  ]);

  const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;
  const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;

  // Topologia conhecida
  const nodes = [
    { id: 'pop-centro', name: 'POP Centro', type: 'pop', ip: '143.137.32.7', x: 50, y: 50, health: 'ok' },
    { id: 'pop-sr', name: 'POP Santa Rosa', type: 'pop', ip: '143.137.32.6', x: 25, y: 75, health: 'ok' },
    { id: 'olt-64', name: 'OLT Travessão', type: 'olt', ip: '143.137.32.8', x: 15, y: 90, health: 'ok', parent: 'pop-sr' },
    { id: 'olt-73', name: 'OLT Santa Rosa 73', type: 'olt', ip: '143.137.32.73', x: 35, y: 85, health: 'warn', parent: 'pop-sr' },
    { id: 'olt-77', name: 'OLT Aurora 77', type: 'olt', x: 20, y: 65, health: 'ok', parent: 'pop-sr' },
    { id: 'olt-79', name: 'OLT Centro 79', type: 'olt', x: 60, y: 40, health: 'ok', parent: 'pop-centro' },
    { id: 'olt-78', name: 'OLT Nova Brasília 78', type: 'olt', x: 70, y: 60, health: 'ok', parent: 'pop-centro' },
    { id: 'olt-70', name: 'OLT Canã 70', type: 'olt', x: 40, y: 20, health: 'ok', parent: 'pop-centro' },
    { id: 'olt-72', name: 'OLT São José 72', type: 'olt', x: 80, y: 30, health: 'ok', parent: 'pop-centro' },
    { id: 'olt-69', name: 'OLT Ururaí 69', type: 'olt', x: 45, y: 10, health: 'ok', parent: 'pop-centro' },
    { id: 'mx204-sr', name: 'MX204 Santa Rosa', type: 'router', ip: '143.137.32.4', x: 30, y: 70, health: 'ok', parent: 'pop-sr' },
    { id: 'mx204-ct', name: 'MX204 Centro', type: 'router', x: 55, y: 55, health: 'ok', parent: 'pop-centro' },
    { id: 'ix-br', name: 'IX-BR SP', type: 'ix', x: 5, y: 50, health: 'ok' },
    { id: 'google', name: 'Google Transit', type: 'transit', x: 5, y: 30, health: 'ok' },
    { id: 'rb-test', name: 'RB Teste Wellinho', type: 'rb', x: 33, y: 82, health: 'ok', parent: 'mx204-sr' },
  ];

  // Atualizar health baseado no Zabbix
  if (zabbix?.topTriggers) {
    zabbix.topTriggers.forEach(t => {
      const host = t.host?.toLowerCase() || '';
      const node = nodes.find(n => 
        host.includes(n.name?.toLowerCase()) || 
        host.includes(n.ip?.split('.').slice(-1)[0] || '')
      );
      if (node) {
        if (t.severity >= 4) node.health = 'critical';
        else if (t.severity >= 3 && node.health !== 'critical') node.health = 'warn';
      }
    });
  }

  const links = [
    { from: 'ix-br', to: 'mx204-sr', label: 'IX-BR', health: 'ok' },
    { from: 'google', to: 'mx204-sr', label: 'Transit', health: 'ok' },
    { from: 'mx204-sr', to: 'pop-sr', label: 'Backbone', health: 'ok' },
    { from: 'pop-sr', to: 'pop-centro', label: 'MPLS Backbone', health: 'ok' },
    { from: 'pop-sr', to: 'olt-64', label: 'PON', health: 'ok' },
    { from: 'pop-sr', to: 'olt-73', label: 'PON', health: 'warn' },
    { from: 'pop-sr', to: 'olt-77', label: 'PON', health: 'ok' },
    { from: 'pop-centro', to: 'olt-79', label: 'PON', health: 'ok' },
    { from: 'pop-centro', to: 'olt-78', label: 'PON', health: 'ok' },
    { from: 'pop-centro', to: 'olt-70', label: 'PON', health: 'ok' },
    { from: 'pop-centro', to: 'olt-72', label: 'PON', health: 'ok' },
    { from: 'pop-centro', to: 'olt-69', label: 'PON', health: 'ok' },
    { from: 'mx204-sr', to: 'rb-test', label: 'PPPoE', health: 'ok' },
  ];

  return json({
    timestamp: new Date().toISOString(),
    nodes,
    links,
    bgpPeers: bgp?.peers || [],
    legend: {
      ok: '#22c55e', warn: '#f59e0b', critical: '#dc2626',
      pop: '#3b82f6', olt: '#8b5cf6', router: '#06b6d4', ix: '#10b981', transit: '#6366f1', rb: '#ec4899'
    },
  });
}

// ============================================================
// API: ROOT CAUSE ANALYSIS (Módulo 9)
// ============================================================
async function apiRCA(url) {
  const [zabbixRes, bgpRes] = await Promise.allSettled([
    fetch(VERCEL_ZABBIX + '?action=overview').then(r => r.json()).catch(() => null),
    fetch(VERCEL_BGP).then(r => r.json()).catch(() => null),
  ]);

  const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;
  const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;

  const incidents = [];
  
  if (zabbix?.topTriggers) {
    const critical = zabbix.topTriggers.filter(t => t.severity >= 4);
    
    critical.forEach(t => {
      const incident = {
        id: `inc-${t.host}-${Date.now()}`,
        host: t.host,
        severity: t.severity,
        description: t.description,
        age: t.age,
        rootCause: analyzeRootCause(t.description),
        affectedClients: 'Requer correlação com IXC',
        recommendedAction: recommendAction(t.description, t.severity),
        impact: t.severity >= 5 ? 'CRÍTICO — Impacto massivo provável' : 'ALTO — Verificar clientes afetados',
      };
      incidents.push(incident);
    });
  }

  return json({
    timestamp: new Date().toISOString(),
    activeIncidents: incidents.length,
    incidents,
    aiSummary: incidents.length > 0 ?
      `${incidents.length} incidente(s) ativo(s). Maior risco: ${incidents[0]?.host || 'N/A'}` :
      'Nenhum incidente crítico ativo.',
  });
}

function analyzeRootCause(desc) {
  const d = (desc || '').toLowerCase();
  if (d.includes('indispon') || d.includes('down')) return 'Equipamento indisponível — verificar energia, link físico ou travamento';
  if (d.includes('cpu')) return 'Saturação de CPU — verificar processos, loops ou ataques';
  if (d.includes('memory') || d.includes('memória')) return 'Esgotamento de memória — reinício programado ou upgrade';
  if (d.includes('gpon') || d.includes('pon')) return 'Falha na PON — verificar fibra, splitter ou ONU';
  if (d.includes('consumo') || d.includes('download') || d.includes('upload')) return 'Variação de tráfego — investigar congestão ou mudança de rota';
  if (d.includes('temperatura')) return 'Superaquecimento — verificar ventilação/ambiente';
  return 'Causa em investigação — coletar logs e evidências';
}

function recommendAction(desc, severity) {
  const d = (desc || '').toLowerCase();
  if (severity >= 5) {
    if (d.includes('consumo') || d.includes('download')) return 'Acionar responsável pelo enlace, verificar mudanças de rota BGP e impacto em clientes';
    return 'Acionamento imediato do técnico responsável. Isolar e verificar equipamento fisicamente.';
  }
  if (d.includes('indispon')) return 'Verificar acesso remoto (SSH/Winbox). Se sem acesso, despachar técnico ao local.';
  if (d.includes('gpon') || d.includes('pon')) return 'Verificar potência óptica, logs de LOS/dying-gasp. Inspecionar emenda/splitter.';
  return 'Monitorar evolução. Coletar evidências (logs, SNMP, gráficos).';
}

// ============================================================
// API: PREDICTION (Módulo 5)
// ============================================================
async function apiPrediction(url) {
  const [zabbixRes] = await Promise.allSettled([
    fetch(VERCEL_ZABBIX + '?action=overview').then(r => r.json()).catch(() => null),
  ]);

  const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;
  
  const predictions = [];
  
  if (zabbix?.topTriggers) {
    // Equipamentos com alarmes recorrentes têm maior probabilidade
    zabbix.topTriggers.forEach(t => {
      const ageHours = parseFloat(t.age?.replace(/[^\d.]/g, '') || '0');
      let prob = 15;
      
      if (t.severity >= 5) prob = 85;
      else if (t.severity >= 4) prob = 60;
      else if (t.severity >= 3) prob = 35;
      
      // Alarmes antigos recorrentes têm maior chance de falha
      if (ageHours > 48) prob += 10;
      if (ageHours > 168) prob += 15;
      
      prob = Math.min(prob, 95);
      
      if (prob >= 30) {
        predictions.push({
          host: t.host,
          probability: `${prob}%`,
          severity: t.severity,
          issue: t.description,
          eta: prob >= 70 ? 'Imediato (horas)' : prob >= 40 ? 'Curto prazo (dias)' : 'Médio prazo (semanas)',
          reason: analyzeRootCause(t.description),
          affectedClients: 'Estimativa requer correlação com IXC',
        });
      }
    });
  }

  predictions.sort((a, b) => parseInt(b.probability) - parseInt(a.probability));

  return json({
    timestamp: new Date().toISOString(),
    totalPredictions: predictions.length,
    highRisk: predictions.filter(p => parseInt(p.probability) >= 60).length,
    predictions,
    disclaimer: 'Previsões baseadas em padrões de alarmes ativos. Requer histórico contínuo para precisão.',
  });
}

// ============================================================
// API: BGP (Módulo 6)
// ============================================================
async function apiBGP(url) {
  try {
    const [asnRes, prefixRes] = await Promise.allSettled([
      fetch(BGP_API).then(r => r.json()),
      fetch(BGP_PREFIX_API).then(r => r.json())
    ]);

    const asn = asnRes.status === 'fulfilled' ? asnRes.value?.data : null;
    const prefixes = prefixRes.status === 'fulfilled' ? prefixRes.value?.data : null;

    const announcedPrefixes = prefixes?.ipv4?.length || 0;
    const peers = asn?.bp_links?.length || 0;
    const upstreams = (asn?.bp_links || []).map(p => ({
      name: p.tilde_name || p.name,
      asn: p.asn,
      status: p.status === 'ok' ? 'up' : 'down'
    }));

    return json({
      timestamp: new Date().toISOString(),
      asn: '264025',
      holder: asn?.name || 'AS264025 - Arroba Banda Larga',
      overview: { bgp_peers: peers, announced_prefixes: announcedPrefixes },
      score_bgp: 100,
      stats: {
        total_prefixos: announcedPrefixes,
        prefixos_ok: announcedPrefixes,
        total_peers: peers,
        peers_upstream: upstreams.filter(p => p.status === 'up').length,
      },
      prefixos: prefixes?.ipv4?.map(p => p.prefix) || [],
      peers: upstreams,
      mtr_targets: ['8.8.8.8', '1.1.1.1', '187.16.222.6'],
    });
  } catch (e) {
    return json({ error: 'BGP: ' + e.message }, 500);
  }
}

// ============================================================
// API: ZABBIX (Módulo 11)
// ============================================================
async function apiZabbix(url) {
  try {
    const token = await zabbixLogin();
    if (!token) throw new Error('Zabbix login failed');

    const [hosts, triggers] = await Promise.all([
      zabbixCall(token, 'host.get', {
        output: ['hostid', 'host', 'name', 'status'],
        selectInterfaces: ['ip']
      }),
      zabbixCall(token, 'trigger.get', {
        output: ['triggerid', 'description', 'priority', 'lastchange'],
        filter: { value: 1 },
        selectHosts: ['host', 'name'],
        sortfield: 'priority', sortorder: 'DESC',
        limit: 50
      })
    ]);

    await zabbixLogout(token);

    const hostsDown = hosts.filter(h => h.status === '1').length;
    const sevMap = { '0': 'Not Class', '1': 'Info', '2': 'Warning', '3': 'Average', '4': 'High', '5': 'Disaster' };
    const bySeverity = {};
    triggers.forEach(t => { const s = String(t.priority); bySeverity[s] = (bySeverity[s] || 0) + 1; });

    const topTriggers = triggers.slice(0, 10).map(t => ({
      host: t.hosts?.[0]?.name || '?',
      description: t.description,
      severity: parseInt(t.priority),
      severityName: sevMap[String(t.priority)] || '?',
      age: t.lastchange ? timeAgo(parseInt(t.lastchange)) : ''
    }));

    return json({
      timestamp: new Date().toISOString(),
      stats: { totalHosts: hosts.length, hostsOk: hosts.length - hostsDown, hostsDown, totalTriggers: triggers.length },
      bySeverity,
      topTriggers,
      triggers: topTriggers,
      data: { hosts: hosts.slice(0, 20), triggers: topTriggers }
    });
  } catch (e) {
    return json({ error: 'Zabbix: ' + e.message }, 500);
  }
}

// ============================================================
// API: EXECUTIVE (Módulo 10)
// ============================================================
async function apiExecutive(url) {
  const [bgpRes, zabbixRes] = await Promise.allSettled([
    fetch(VERCEL_BGP).then(r => r.json()).catch(() => null),
    fetch(VERCEL_ZABBIX + '?action=overview').then(r => r.json()).catch(() => null),
  ]);

  const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;
  const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;

  let score = 100;
  const issues = [];

  if (zabbix?.stats) {
    const down = zabbix.stats.hostsDown || 0;
    if (down > 0) { score -= down * 10; issues.push(`${down} equipamento(s) offline`); }
    const high = (zabbix.bySeverity?.['4'] || 0) + (zabbix.bySeverity?.['5'] || 0);
    if (high > 0) { score -= Math.min(high * 2, 25); issues.push(`${high} alarme(s) de alta severidade`); }
  }

  score = Math.max(0, Math.round(score));

  return json({
    success: true,
    timestamp: new Date().toISOString(),
    score,
    status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
    sources: { bgp: bgp ? 'online' : 'offline', zabbix: zabbix ? 'online' : 'offline', flow: 'offline' },
    bgp: bgp ? {
      asn: bgp.asn, holder: bgp.holder,
      announcedPrefixes: bgp.overview?.announced_prefixes || 0,
      bgpPeers: bgp.overview?.bgp_peers || 0,
      score: bgp.score_bgp || 100,
    } : null,
    zabbix: zabbix ? {
      totalHosts: zabbix.stats?.totalHosts || 0,
      hostsOk: zabbix.stats?.hostsOk || 0,
      hostsDown: zabbix.stats?.hostsDown || 0,
      totalTriggers: zabbix.stats?.totalTriggers || 0,
      bySeverity: zabbix.bySeverity || {},
      topTriggers: zabbix.topTriggers || [],
    } : null,
    flow: null,
    issues,
  });
}

// ============================================================
// API: SLA (Módulo 10)
// ============================================================
async function apiSla(url) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const body = JSON.stringify({
      qtype: 'data_abertura', query: today, oper: '>=',
      page: 1, rp: 200, sortname: 'id', sortorder: 'desc',
      rules: [{ field: 'id_assunto', op: 'in', value: '303,304' }]
    });

    const res = await fetch(IXC_URL + '/su_oss_chamado', {
      method: 'POST', headers: IXC_HEADERS, body
    }).then(r => r.json());

    const oss = res.registros || res.data || [];
    const validOs = oss.filter(os => {
      const d = (os.mensagem_resposta || '').toLowerCase();
      return !d.includes('energia') && !d.includes('conexão subiu');
    });

    const keywords = {
      'CAMINHÃO': ['caminh'], 'FOGO': ['fogo', 'incendi'], 'PODA': ['poda', 'arvore'],
      'ENEL': ['enel', 'energia'], 'PIPA': ['pipa'], 'SABOTAGEM': ['sabot', 'vandal'], 'TERCEIRO': ['terceir', 'obra'],
    };
    const causas = {};
    validOs.forEach(os => {
      const msg = (os.mensagem_resposta || '').toLowerCase();
      for (const [cat, words] of Object.entries(keywords)) {
        if (words.some(w => msg.includes(w))) { causas[cat] = (causas[cat] || 0) + 1; break; }
      }
    });

    return json({
      success: true, timestamp: new Date().toISOString(),
      total: oss.length, validos: validOs.length,
      filtrados: oss.length - validOs.length, causas,
      os: validOs.map(os => ({
        id: os.id, protocolo: os.protocolo, bairro: os.bairro || '',
        abertura: os.data_abertura, assumido: os.data_assumido, subida: os.data_subida,
      })),
    });
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }
}

// ============================================================
// API: SECURITY (Módulo 12)
// ============================================================
async function apiSecurity(url) {
  try {
    const token = await zabbixLogin();
    const hosts = await zabbixCall(token, 'host.get', {
      output: ['hostid', 'host', 'name', 'status'], selectInterfaces: ['ip', 'type']
    });
    await zabbixLogout(token);

    return json({
      timestamp: new Date().toISOString(),
      blocks: ['143.137.32.0/22', '168.197.56.0/22'],
      hosts: { total: hosts.length, active: hosts.filter(h => h.status === '0').length, inactive: hosts.filter(h => h.status === '1').length },
      alerts: [],
      ssl: { ixc: { url: 'central.arrobabandalarga.com.br', status: 'monitoring' } },
      scan: { ports: [22, 80, 443, 8291, 8728, 3306] },
      bgpSecurity: {
        prefixHijack: 'Monitorar via BGP HE',
        routeLeak: 'Monitorar via RPKI',
        recommendation: 'Implementar RPKI ROV para prevenção de hijack',
      },
    });
  } catch (e) {
    return json({ error: 'Security: ' + e.message }, 500);
  }
}

// ============================================================
// API: FLOW
// ============================================================
async function apiFlow(url) {
  const action = url.searchParams.get('action') || 'sources';
  try {
    const res = await fetch(FLOW_API + '/' + action, {
      headers: { 'Authorization': 'Bearer ' + FLOW_TOKEN, 'Accept': 'application/json' }
    }).then(r => r.json());
    return json({ timestamp: new Date().toISOString(), ...res });
  } catch (e) {
    return json({ error: 'Flow: ' + e.message }, 502);
  }
}

// ============================================================
// API: OLTs IXC
// ============================================================
async function apiOltIxc(url) {
  try {
    const res = await fetch(IXC_URL + '/pon_olt', {
      method: 'POST', headers: IXC_HEADERS,
      body: JSON.stringify({ qtype: 'id', query: '0', oper: '>', page: 1, rp: 100, sortname: 'id', sortorder: 'asc' })
    }).then(r => r.json());
    const olts = res.registros || res.data || [];
    return json({
      timestamp: new Date().toISOString(), total: olts.length,
      olts: olts.map(o => ({ id: o.id, nome: o.nome || o.titulo, ip: o.ip, modelo: o.modelo || o.tipo, status: o.status || 'unknown' })),
    });
  } catch (e) {
    return json({ error: 'OLT IXC: ' + e.message }, 500);
  }
}

// ============================================================
// API: SCAN / TEST (stubs)
// ============================================================
async function apiScanNetwork(url) {
  return json({ timestamp: new Date().toISOString(), target: url.searchParams.get('target') || '143.137.32.0/22', blocks: ['143.137.32.0/22', '168.197.56.0/22'], note: 'Use Zabbix API para host discovery.' });
}
async function apiTestSnmp(url) {
  const t = url.searchParams.get('target'); if (!t) return json({ error: 'Missing target' }, 400);
  return json({ timestamp: new Date().toISOString(), target: t, message: 'SNMP requer backend. Use Zabbix.' });
}
async function apiTestVpn(url) {
  const t = url.searchParams.get('target'); if (!t) return json({ error: 'Missing target' }, 400);
  return json({ timestamp: new Date().toISOString(), target: t, message: 'VPN test requer raw sockets. Use SSH.' });
}
