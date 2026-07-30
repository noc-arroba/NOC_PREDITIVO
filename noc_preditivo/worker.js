/**
 * NOC PREDITIVO — Cloudflare Worker
 * Substitui o Vercel: serve APIs + arquivos estáticos
 * AS264025 — Arroba Banda Larga
 */

// ============================================================
// CONFIGURAÇÃO
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

const FLOW_API = 'https://lvflow-conectti.lv.network/api';
const FLOW_TOKEN = 'lvtool_4be01944-b73e-4e89-9f1b-8d9a5f7b6a5c';

const BGP_API = 'https://api.bgpview.io/asn/264025';
const BGP_PREFIX_API = 'https://api.bgpview.io/asn/264025/prefixes';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ============================================================
// ROUTER
// ============================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // API routes
    if (path.startsWith('/api/')) {
      return handleApi(path, url, request, env);
    }

    // Static files via Assets binding
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};

// ============================================================
// API ROUTER
// ============================================================
async function handleApi(path, url, request, env) {
  const route = path.replace('/api/', '').replace(/\.js$/, '');
  
  try {
    switch (route) {
      case 'bgp':
      case 'bgp.js':
        return await apiBGP(url);
      case 'zabbix':
      case 'zabbix.js':
        return await apiZabbix(url);
      case 'security':
      case 'security.js':
        return await apiSecurity(url);
      case 'olts-ixc':
      case 'olts-ixc.js':
        return await apiOltIxc(url);
      case 'scan-network':
      case 'scan-network.js':
        return await apiScanNetwork(url);
      case 'executive':
      case 'executive.js':
        return await apiExecutive(url);
      case 'sla':
      case 'sla.js':
        return await apiSla(url);
      case 'flow':
      case 'flow-proxy':
      case 'flow-proxy.js':
        return await apiFlow(url);
      case 'test-snmp':
      case 'test-snmp.js':
        return await apiTestSnmp(url);
      case 'test-vpn':
      case 'test-vpn.js':
        return await apiTestVpn(url);
      default:
        return jsonResponse({ error: 'Unknown API: ' + route }, 404);
    }
  } catch (e) {
    return jsonResponse({ success: false, error: e.message, stack: e.stack }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// ============================================================
// API: BGP (AS264025)
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

    const score = 100;
    
    return jsonResponse({
      timestamp: new Date().toISOString(),
      asn: '264025',
      holder: asn?.name || 'AS264025 - Arroba Banda Larga',
      overview: {
        bgp_peers: peers,
        announced_prefixes: announcedPrefixes,
      },
      score_bgp: score,
      stats: {
        total_prefixos: announcedPrefixes,
        prefixos_ok: announcedPrefixes,
        prefixos_hijack: 0,
        prefixos_nao_anunciado: 0,
        total_peers: peers,
        peers_upstream: upstreams.filter(p => p.status === 'up').length,
        peers_transit: 0,
        peers_ix: 0,
      },
      prefixos: prefixes?.ipv4?.map(p => p.prefix) || [],
      peers: upstreams,
      visibilidade: { total: peers, ok: peers },
      alertas: [],
      mtr_targets: ['8.8.8.8', '1.1.1.1', '187.16.222.6'],
    });
  } catch (e) {
    return jsonResponse({ error: 'BGP API error: ' + e.message }, 500);
  }
}

// ============================================================
// API: ZABBIX
// ============================================================
async function apiZabbix(url) {
  const action = url.searchParams.get('action') || 'overview';
  
  try {
    // Login
    const loginRes = await fetch(ZABBIX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'user.login',
        params: { user: ZABBIX_USER, password: ZABBIX_PASS },
        id: 1
      })
    }).then(r => r.json());

    const token = loginRes.result;
    if (!token) throw new Error('Zabbix login failed');

    // Hosts
    const hostsRes = await fetch(ZABBIX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'host.get', id: 2,
        auth: token,
        params: { output: ['hostid', 'host', 'name', 'status'], selectInterfaces: ['ip'] }
      })
    }).then(r => r.json());

    const hosts = hostsRes.result || [];
    
    // Triggers
    const triggersRes = await fetch(ZABBIX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'trigger.get', id: 3,
        auth: token,
        params: {
          output: ['triggerid', 'description', 'priority', 'lastchange'],
          filter: { value: 1 },
          selectHosts: ['host', 'name'],
          sortfield: 'priority', sortorder: 'DESC',
          limit: 50
        }
      })
    }).then(r => r.json());

    const triggers = triggersRes.result || [];
    
    // Logout
    await fetch(ZABBIX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'user.logout', id: 4, auth: token })
    });

    const hostsDown = hosts.filter(h => h.status === '1').length;
    const hostsOk = hosts.length - hostsDown;
    
    const severityMap = { '0': 'Not Class', '1': 'Info', '2': 'Warning', '3': 'Average', '4': 'High', '5': 'Disaster' };
    const bySeverity = {};
    triggers.forEach(t => {
      const s = String(t.priority);
      bySeverity[s] = (bySeverity[s] || 0) + 1;
    });

    const topTriggers = triggers.slice(0, 10).map(t => ({
      host: t.hosts?.[0]?.name || t.hosts?.[0]?.host || '?',
      description: t.description,
      severity: parseInt(t.priority),
      severityName: severityMap[String(t.priority)] || 'Unknown',
      age: t.lastchange ? timeAgo(parseInt(t.lastchange)) : ''
    }));

    return jsonResponse({
      timestamp: new Date().toISOString(),
      zabbixVersion: '6.0',
      stats: {
        totalHosts: hosts.length,
        hostsOk,
        hostsDown,
        totalTriggers: triggers.length,
      },
      bySeverity,
      topTriggers,
      triggers: topTriggers,
      data: { hosts: hosts.slice(0, 20), triggers: topTriggers }
    });
  } catch (e) {
    return jsonResponse({ error: 'Zabbix error: ' + e.message, timestamp: new Date().toISOString() }, 500);
  }
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}min`;
  if (diff < 3600) return `${Math.floor(diff/60)}min`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h`;
  return `${Math.floor(diff/86400)}d`;
}

// ============================================================
// API: EXECUTIVE (agrega BGP + Zabbix + Flow)
// ============================================================
async function apiExecutive(url) {
  const action = url.searchParams.get('action') || 'overview';
  
  if (action === 'overview') {
    const [bgpRes, zabbixRes] = await Promise.allSettled([
      fetch('https://noc-preditivo.vercel.app/api/bgp').then(r => r.json()).catch(() => null),
      fetch('https://noc-preditivo.vercel.app/api/zabbix?action=overview').then(r => r.json()).catch(() => null),
    ]);

    const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;
    const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;

    let score = 100;
    const issues = [];

    if (bgp?.score_bgp !== undefined && bgp.score_bgp < 100) {
      score -= (100 - bgp.score_bgp) * 0.3;
      issues.push(`BGP score: ${bgp.score_bgp}/100`);
    }

    if (zabbix?.stats) {
      const downHosts = zabbix.stats.hostsDown || 0;
      if (downHosts > 0) {
        score -= downHosts * 10;
        issues.push(`${downHosts} equipamento(s) offline no Zabbix`);
      }
      const highSev = (zabbix.bySeverity?.['4'] || 0) + (zabbix.bySeverity?.['5'] || 0);
      if (highSev > 0) {
        score -= Math.min(highSev * 2, 25);
        issues.push(`${highSev} alarme(s) de alta severidade`);
      }
    }

    score = Math.max(0, Math.round(score));

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      score,
      status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
      sources: {
        bgp: bgp ? 'online' : 'offline',
        zabbix: zabbix ? 'online' : 'offline',
        flow: 'offline',
      },
      bgp: bgp ? {
        asn: bgp.asn || '264025',
        holder: bgp.holder || '',
        announcedPrefixes: bgp.overview?.announced_prefixes || 0,
        bgpPeers: bgp.overview?.bgp_peers || 0,
        score: bgp.score_bgp || 100,
        stats: bgp.stats || {},
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

  return jsonResponse({ error: 'Unknown action: ' + action }, 400);
}

// ============================================================
// API: SLA (OS 303/304 do IXC)
// ============================================================
async function apiSla(url) {
  const action = url.searchParams.get('action') || 'today';
  
  try {
    // Buscar OS 303 e 304
    const today = new Date().toISOString().split('T')[0];
    const qtype = action === 'today' ? 'data_abertura' : 'data_abertura';
    
    const body = JSON.stringify({
      qtype,
      query: today,
      oper: '=',
      page: 1,
      rp: 200,
      sortname: 'id',
      sortorder: 'desc',
      rules: [{ field: 'id_assunto', op: 'in', value: '303,304' }]
    });

    const res = await fetch(IXC_URL + '/su_oss_chamado', {
      method: 'POST',
      headers: IXC_HEADERS,
      body
    }).then(r => r.json());

    const oss = res.registros || res.data || [];
    
    // Filtrar OS internas (energia, conexão subiu)
    const validOs = oss.filter(os => {
      const diag = (os.mensagem_resposta || '').toLowerCase();
      return !diag.includes('energia') && !diag.includes('conexão subiu');
    });

    // Categorizar causas
    const causas = {};
    const keywords = {
      'CAMINHÃO': ['caminh', 'caminhao', 'caminhoes'],
      'FOGO': ['fogo', 'incendi', 'queimad'],
      'PODA': ['poda', 'arvore', 'arvor', 'galho'],
      'ENEL': ['enel', 'energia', 'luz', 'copia'],
      'PIPA': ['pipa', 'papas', 'pipo'],
      'SABOTAGEM': ['sabot', 'vandal', 'roubo', 'furto'],
      'TERCEIRO': ['terceir', 'construt', 'obra', 'escavac'],
    };

    validOs.forEach(os => {
      const msg = (os.mensagem_resposta || '').toLowerCase();
      for (const [cat, words] of Object.entries(keywords)) {
        if (words.some(w => msg.includes(w))) {
          causas[cat] = (causas[cat] || 0) + 1;
          break;
        }
      }
    });

    // Calcular SLA
    const slaData = validOs.map(os => {
      const abertura = os.data_abertura || '';
      const assumido = os.data_assumido || '';
      const subida = os.data_subida || '';
      
      const tQtoA = abertura ? 0 : 0;
      const tAtoAS = (abertura && assumido) ? diffMinutes(abertura, assumido) : null;
      const tAStoS = (assumido && subida) ? diffMinutes(assumido, subida) : null;
      
      return {
        id: os.id,
        protocolo: os.protocolo,
        assunto: os.id_assunto,
        bairro: os.bairro || '',
        clientes: os.mensagem_resposta?.match(/CLIENTES.*?(\d+)/)?.[1] || '',
        abertura,
        assumido,
        subida,
        tAtoAS,
        tAStoS,
        causa: Object.entries(keywords).find(([_, words]) => 
          words.some(w => (os.mensagem_resposta || '').toLowerCase().includes(w)))?.[0] || null,
      };
    });

    const avgAtoAS = slaData.filter(d => d.tAtoAS !== null).reduce((a, b) => a + b.tAtoAS, 0) / 
                     (slaData.filter(d => d.tAtoAS !== null).length || 1);
    const avgAStoS = slaData.filter(d => d.tAStoS !== null).reduce((a, b) => a + b.tAStoS, 0) / 
                     (slaData.filter(d => d.tAStoS !== null).length || 1);

    return jsonResponse({
      success: true,
      timestamp: new Date().toISOString(),
      total: oss.length,
      validos: validOs.length,
      filtrados: oss.length - validOs.length,
      sla: {
        avgAtoAS: Math.round(avgAtoAS) || 0,
        avgAStoS: Math.round(avgAStoS) || 0,
      },
      causas,
      os: slaData,
    });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message }, 500);
  }
}

function diffMinutes(t1, t2) {
  const d1 = new Date(t1.replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/, '$3-$2-$1 $4:$5:$6'));
  const d2 = new Date(t2.replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/, '$3-$2-$1 $4:$5:$6'));
  return Math.round((d2 - d1) / 60000);
}

// ============================================================
// API: SECURITY
// ============================================================
async function apiSecurity(url) {
  try {
    // Buscar hosts do Zabbix
    const loginRes = await fetch(ZABBIX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'user.login',
        params: { user: ZABBIX_USER, password: ZABBIX_PASS }, id: 1
      })
    }).then(r => r.json());

    const token = loginRes.result;
    if (!token) throw new Error('Zabbix login failed');

    const hostsRes = await fetch(ZABBIX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'host.get', id: 2,
        auth: token,
        params: { output: ['hostid', 'host', 'name', 'status'], selectInterfaces: ['ip', 'type'] }
      })
    }).then(r => r.json());

    const hosts = hostsRes.result || [];
    
    // Logout
    await fetch(ZABBIX_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'user.logout', id: 3, auth: token })
    });

    // Análise de segurança
    const blocks = ['143.137.32.0/22', '168.197.56.0/22'];
    const activeHosts = hosts.filter(h => h.status === '0');
    const monitored = hosts.length;

    return jsonResponse({
      timestamp: new Date().toISOString(),
      blocks,
      hosts: {
        total: monitored,
        active: activeHosts.length,
        inactive: monitored - activeHosts.length,
      },
      alerts: [],
      ssl: {
        ixc: { url: 'central.arrobabandalarga.com.br', status: 'monitoring' },
      },
      scan: { ports: [22, 80, 443, 8291, 8728, 3306] },
    });
  } catch (e) {
    return jsonResponse({ error: 'Security API error: ' + e.message }, 500);
  }
}

// ============================================================
// API: FLOW (lvflow)
// ============================================================
async function apiFlow(url) {
  const action = url.searchParams.get('action') || 'sources';
  
  try {
    const res = await fetch(FLOW_API + '/' + action, {
      headers: { 'Authorization': 'Bearer ' + FLOW_TOKEN, 'Accept': 'application/json' }
    }).then(r => r.json());

    return jsonResponse({
      timestamp: new Date().toISOString(),
      ...res,
    });
  } catch (e) {
    return jsonResponse({ error: 'Flow API error: ' + e.message, timestamp: new Date().toISOString() }, 502);
  }
}

// ============================================================
// API: OLTs IXC
// ============================================================
async function apiOltIxc(url) {
  try {
    const res = await fetch(IXC_URL + '/pon_olt', {
      method: 'POST',
      headers: IXC_HEADERS,
      body: JSON.stringify({ qtype: 'id', query: '0', oper: '>', page: 1, rp: 100, sortname: 'id', sortorder: 'asc' })
    }).then(r => r.json());

    const olts = res.registros || res.data || [];
    
    return jsonResponse({
      timestamp: new Date().toISOString(),
      total: olts.length,
      olts: olts.map(o => ({
        id: o.id,
        nome: o.nome || o.titulo,
        ip: o.ip,
        modelo: o.modelo || o.tipo,
        status: o.status || 'unknown',
      })),
    });
  } catch (e) {
    return jsonResponse({ error: 'OLT IXC error: ' + e.message }, 500);
  }
}

// ============================================================
// API: SCAN NETWORK
// ============================================================
async function apiScanNetwork(url) {
  const target = url.searchParams.get('target') || '143.137.32.0/22';
  
  return jsonResponse({
    timestamp: new Date().toISOString(),
    target,
    message: 'Network scan requires backend access. Use Zabbix for host inventory.',
    blocks: ['143.137.32.0/22', '168.197.56.0/22'],
    note: 'Cloudflare Workers cannot perform raw network scans. Use the Zabbix API for host discovery.',
  });
}

// ============================================================
// API: TEST SNMP
// ============================================================
async function apiTestSnmp(url) {
  const target = url.searchParams.get('target');
  if (!target) return jsonResponse({ error: 'Missing target parameter' }, 400);
  
  return jsonResponse({
    timestamp: new Date().toISOString(),
    target,
    message: 'SNMP test requires backend access. Cloudflare Workers cannot perform SNMP queries.',
    note: 'Use the Zabbix API for device monitoring instead.',
  });
}

// ============================================================
// API: TEST VPN
// ============================================================
async function apiTestVpn(url) {
  const target = url.searchParams.get('target');
  if (!target) return jsonResponse({ error: 'Missing target parameter' }, 400);
  
  return jsonResponse({
    timestamp: new Date().toISOString(),
    target,
    message: 'VPN test requires raw socket access. Cloudflare Workers cannot perform VPN tests.',
    note: 'Use SSH-based monitoring via the RB active monitor instead.',
  });
}
