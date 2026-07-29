// NOC Preditivo — API Executiva
// Agrega BGP (RIPE Stat) + Zabbix + Flow (RR) em Health Score consolidado

const FLOW_BASE = 'https://lvflow-conectti.lv.network';
const FLOW_TOKEN = '8OEHA-R5hLuuOerVPZ3HqdfCehlNF3ngOayQVGq7T1M';
const ZABBIX_URL = 'http://143.137.32.8:9090/zabbix/api_jsonrpc.php';
const ZABBIX_TOKEN = 'b43086606cc8e30738c7fea7b2e4ffc2c7cc6c27d81c11832a13c96940d2bc71';
const ASN = '264025';
const SOURCES = ['ANB-BRAS01-MX204-CENTRO','ANB-BRAS02-MX204-STA-ROSA','ANB-TH4430-A10-CGNAT-01'];

const TOPOLOGY: any = {
  core: [
    {n:'MX204 Centro',ip:'143.137.32.3',f:'BGP/PPPoE BRAS',m:'Juniper MX204',z:'MX 204 - PPPOE1'},
    {n:'MX204 Sta Rosa',ip:'143.137.32.4',f:'BGP/PPPoE BRAS',m:'Juniper MX204',z:'MX 204 - PPPOE2'},
    {n:'CCR Santa Rosa',ip:'143.137.32.6',f:'VPN L2TP',m:'Mikrotik CCR',z:'CCR SERVER_SANTA ROSA'},
    {n:'CCR Centro 1',ip:'143.137.32.8',f:'NAS/PPPoE',m:'CCR 1072',z:'CCR SERVER 1072'},
    {n:'CCR Centro 2',ip:'143.137.32.7',f:'NAS/PPPoE',m:'CCR 1036',z:'CCR SERVER 1036'},
    {n:'A10 CGNAT',ip:'143.137.32.5',f:'CGNAT/NAT64',m:'A10 Thunder',z:null}
  ],
  pop: [
    {n:'POP Centro',t:'Fibra',olt:'79'},{n:'POP Santa Rosa',t:'Fibra',olt:'73/74/76'},
    {n:'POP Canã',t:'Fibra',olt:'69'},{n:'POP Ururaí',t:'Fibra',olt:'70'},
    {n:'POP São José',t:'Fibra',olt:'72'},{n:'POP Aurora',t:'Fibra',olt:'77'},
    {n:'POP Nova Brasília',t:'Fibra',olt:'78'},{n:'POP Travessão',t:'Fibra',olt:'64'},
    {n:'POP Titan',t:'Fibra',olt:'82'}
  ],
  upstreams: [
    {asn:'6939',n:'Hurricane Electric',t:'transit_internacional'},
    {asn:'14840',n:'BR.Digital',t:'upstream_nacional'},
    {asn:'268696',n:'Tuddo Telecom',t:'upstream_nacional'},
    {asn:'263009',n:'Forte Telecom',t:'upstream_nacional'},
    {asn:'22548',n:'NIC.BR (IX.br)',t:'ix_ptt'}
  ]
};

function fmtBps(b: number): string {
  if (b >= 1e9) return (b/1e9).toFixed(1)+' Gbps';
  if (b >= 1e6) return (b/1e6).toFixed(1)+' Mbps';
  if (b >= 1e3) return (b/1e3).toFixed(1)+' Kbps';
  return b+' bps';
}

async function fetchJSON(url: string, timeout = 10000): Promise<any> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function zabbixCall(method: string, params: any): Promise<any> {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const res = await fetch(ZABBIX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json-rpc', 'Authorization': 'Bearer '+ZABBIX_TOKEN },
    body,
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.data || data.error.message);
  return data.result;
}

async function flowAPI(endpoint: string, params: any = {}): Promise<any> {
  const url = new URL(`${FLOW_BASE}/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${FLOW_TOKEN}` } });
  if (!res.ok) throw new Error(`Flow ${endpoint}: ${res.status}`);
  return res.json();
}

async function getZabbix(): Promise<any> {
  try {
    const [hosts, triggers] = await Promise.all([
      zabbixCall('host.get', { output: ['hostid','name','status'], selectInterfaces: ['ip','available','error'], filter: { status: 0 } }),
      zabbixCall('trigger.get', { output: ['triggerid','description','priority','value','lastchange'], selectHosts: ['name','hostid'], filter: { value: 1 }, sortfield: 'lastchange', sortorder: 'DESC', limit: 50 })
    ]);
    let ok = 0, down = 0;
    const infra: any = {};
    for (const h of hosts) {
      const i = h.interfaces?.[0];
      if (i?.available === '1') ok++;
      else if (i?.available === '2') down++;
      const n = h.name.toUpperCase();
      if (n.includes('MX 204') || n.includes('CCR SERVER') || n.includes('BGP') || n.includes('OLT') || n.includes('ENERGIA')) {
        infra[h.name] = { ip: i?.ip, available: i?.available, status: i?.available === '1' ? 'UP' : i?.available === '2' ? 'DOWN' : 'UNKNOWN' };
      }
    }
    const now = Date.now() / 1000;
    const tf = triggers.map((t: any) => {
      const sev = parseInt(t.priority || 0);
      const age = now - parseInt(t.lastchange || 0);
      let at: string;
      if (age < 60) at = Math.floor(age) + 's';
      else if (age < 3600) at = Math.floor(age/60) + 'min';
      else if (age < 86400) at = (age/3600).toFixed(1) + 'h';
      else at = (age/86400).toFixed(1) + 'd';
      return { host: t.hosts?.[0]?.name || 'N/A', description: t.description, severity: sev, severityName: ['NA','INFO','WARN','MED','HIGH','DISAS'][sev] || '?', ageTxt: at };
    });
    return { totalHosts: hosts.length, hostsOk: ok, hostsDown: down, totalTriggers: triggers.length, triggers: tf, infraHosts: infra };
  } catch (e: any) {
    return { error: e.message, totalHosts: 0, totalTriggers: 0, triggers: [] };
  }
}

async function getBGP(): Promise<any> {
  try {
    const [ov, peers] = await Promise.all([
      fetchJSON(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${ASN}`),
      fetchJSON(`https://stat.ripe.net/data/asn-neighbours/data.json?resource=AS${ASN}`)
    ]);
    const nb = (peers.data || {}).neighbours || [];
    const active = nb.filter((n: any) => n.power > 0);
    let ps: any = null;
    try {
      const pd = await fetchJSON(`https://stat.ripe.net/data/prefix-overview/data.json?resource=143.137.32.0/22`);
      ps = { prefix: '143.137.32.0/22', announced: pd.data?.announced || false, origin_asn: pd.data?.asns?.[0]?.asn || null, origin_holder: pd.data?.asns?.[0]?.holder || null };
    } catch {}
    return { asn: ASN, holder: ov.data?.holder || 'Arroba Banda Larga', announced_prefixes: ov.data?.announced_prefixes || 22, total_peers: nb.length, active_peers: active.length, prefix_status: ps };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function getFlow(): Promise<any> {
  try {
    const results = await Promise.all(SOURCES.map(async (s) => {
      try {
        const d = await flowAPI('traffic-interfaces', { source: s, minutes: 1 });
        const rx = (d.series?.rx || []).reduce((sum: number, i: any) => { const a = i.data?.bps || []; return sum + (a[a.length-1] || 0); }, 0);
        const tx = (d.series?.tx || []).reduce((sum: number, i: any) => { const a = i.data?.bps || []; return sum + (a[a.length-1] || 0); }, 0);
        return { source: s, rx, tx, rx_fmt: fmtBps(rx), tx_fmt: fmtBps(tx) };
      } catch {
        return { source: s, rx: 0, tx: 0, error: true };
      }
    }));
    const trx = results.reduce((s: number, r: any) => s + (r.rx || 0), 0);
    const ttx = results.reduce((s: number, r: any) => s + (r.tx || 0), 0);
    return { sources: results, total_rx: trx, total_tx: ttx, total_rx_fmt: fmtBps(trx), total_tx_fmt: fmtBps(ttx) };
  } catch (e: any) {
    return { error: e.message, sources: [] };
  }
}

function calcHealth(z: any, b: any, f: any): any {
  let score = 100;
  const factors: any[] = [];
  if (b && !b.error) {
    if (b.prefix_status && !b.prefix_status.announced) { score -= 30; factors.push({ a: 'BGP', r: 'Prefixo não anunciado' }); }
    if ((b.active_peers || 0) < 15) { score -= 5; factors.push({ a: 'BGP', r: 'Poucos peers ativos' }); }
  }
  if (z && !z.error) {
    const c = (z.triggers || []).filter((t: any) => t.severity >= 4).length;
    const h = (z.triggers || []).filter((t: any) => t.severity === 3).length;
    if (c > 0) { const p = Math.min(25, c * 2); score -= p; factors.push({ a: 'Zabbix', r: `${c} críticos` }); }
    if (h > 0) { const p = Math.min(10, h); score -= p; factors.push({ a: 'Zabbix', r: `${h} altos` }); }
    if ((z.hostsDown || 0) > 0) { score -= Math.min(10, z.hostsDown * 2); factors.push({ a: 'Zabbix', r: `${z.hostsDown} hosts down` }); }
  }
  if (f && f.sources) { const e = f.sources.filter((s: any) => s.error).length; if (e > 0) { score -= e * 3; factors.push({ a: 'Flow', r: `${e} fonte(s) erro` }); } }
  score = Math.max(0, Math.min(100, Math.round(score)));
  let status = 'SAUDÁVEL', color = '#10b981';
  if (score < 50) { status = 'CRÍTICO'; color = '#ef4444'; }
  else if (score < 75) { status = 'ATENÇÃO'; color = '#f59e0b'; }
  return { score, status, color, factors };
}

function analyzeTrends(z: any, f: any): any[] {
  const preds: any[] = [];
  if (f && f.sources) {
    for (const s of f.sources) {
      if (s.error) continue;
      const pct = (s.rx / 100e9) * 100;
      if (pct > 80) { preds.push({ severidade: 'alto', equipamento: s.source, probabilidade: Math.round(pct), impacto_estimado: `${pct.toFixed(1)}% utilização`, acao: 'Planejar upgrade' }); }
      else if (pct > 60) { preds.push({ severidade: 'atencao', equipamento: s.source, probabilidade: Math.round(pct), impacto_estimado: `${pct.toFixed(1)}% utilização`, acao: 'Acompanhar crescimento' }); }
    }
  }
  if (z && z.triggers) {
    const infra = z.triggers.filter((t: any) => { const h = t.host.toUpperCase(); return h.includes('OLT') || h.includes('MX') || h.includes('CCR') || h.includes('BGP'); });
    for (const t of infra) {
      if (t.severity >= 4) { preds.push({ severidade: 'critico', equipamento: t.host, probabilidade: 80, impacto_estimado: `Trigger: ${t.description}`, acao: `Acionar — verificar ${t.host}`, idade: t.ageTxt }); }
    }
    const byHost: any = {};
    for (const t of z.triggers) byHost[t.host] = (byHost[t.host] || 0) + 1;
    for (const [host, count] of Object.entries(byHost)) {
      if (count >= 3) { preds.push({ severidade: 'alto', equipamento: host, probabilidade: 70, impacto_estimado: `${count} triggers simultâneos — possível cascata`, acao: `Investigar ${host} como SPOF` }); }
    }
  }
  return preds;
}

function buildAlerts(z: any): any[] {
  if (!z || z.error || !z.triggers) return [];
  const groups: any = {};
  for (const t of z.triggers) {
    const lvl = t.severity >= 4 ? 'critico' : t.severity === 3 ? 'alto' : t.severity === 2 ? 'medio' : 'info';
    if (!groups[lvl]) groups[lvl] = { level: lvl, items: [] };
    groups[lvl].items.push(t);
  }
  return Object.values(groups).map((g: any) => ({ ...g, count: g.items.length, items: g.items.slice(0, 10) }));
}

export default async function(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [zabbix, bgp, flow] = await Promise.all([getZabbix(), getBGP(), getFlow()]);
    const health = calcHealth(zabbix, bgp, flow);
    const predictions = analyzeTrends(zabbix, flow);
    const alerts = buildAlerts(zabbix);
    return res.json({
      timestamp: new Date().toISOString(),
      health, topology: TOPOLOGY, zabbix, bgp, flow, predictions, alerts
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
