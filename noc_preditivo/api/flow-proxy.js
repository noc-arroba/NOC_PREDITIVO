// ============================================================
// NOC PREDITIVO — Flow API Proxy
// Proxy para RR Flow (lvflow-conectti.lv.network)
// Tráfego + Ping/Traceroute ativos
// ============================================================

const FLOW_BASE = 'https://lvflow-conectti.lv.network';
const FLOW_TOKEN = '8OEHA-R5hLuuOerVPZ3HqdfCehlNF3ngOayQVGq7T1M';
const FLOW_USER = 'otia';
const FLOW_PASS = 'Arr0b@2019Bl';

const SOURCES = [
  'ANB-BRAS01-MX204-CENTRO',
  'ANB-BRAS02-MX204-STA-ROSA',
  'ANB-TH4430-A10-CGNAT-01'
];

// Cache de sessão (cookie + CSRF)
let sessionCache = { cookie: null, csrf: null, ts: 0 };
const SESSION_TTL = 600000; // 10 min

async function getSession() {
  const now = Date.now();
  if (sessionCache.cookie && (now - sessionCache.ts) < SESSION_TTL) {
    return sessionCache;
  }

  // Login
  const loginRes = await fetch(`${FLOW_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(FLOW_USER)}&password=${encodeURIComponent(FLOW_PASS)}`,
    redirect: 'manual'
  });

  const cookie = loginRes.headers.get('set-cookie') || '';
  const sessionCookie = cookie.split(';')[0]; // session=...

  if (!sessionCookie.includes('session')) {
    throw new Error('Flow login failed');
  }

  // Pegar CSRF token
  const pageRes = await fetch(`${FLOW_BASE}/admin/ping-traceroute`, {
    headers: { Cookie: sessionCookie }
  });
  const html = await pageRes.text();
  const csrfMatch = html.match(/csrf-token" content="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  sessionCache = { cookie: sessionCookie, csrf, ts: now };
  return sessionCache;
}

async function flowAPI(endpoint, params = {}) {
  const url = new URL(`${FLOW_BASE}/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${FLOW_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Flow API ${endpoint}: ${res.status}`);
  return res.json();
}

// Ping via SSE — coleta resultados e retorna JSON
async function flowPing(target, count = 5) {
  const session = await getSession();
  const url = `${FLOW_BASE}/system-api/ping?ip=${encodeURIComponent(target)}&count=${count}&mtu=1`;

  const res = await fetch(url, {
    headers: {
      'Cookie': session.cookie,
      'X-CSRFToken': session.csrf
    }
  });

  if (!res.ok) throw new Error(`Ping failed: ${res.status}`);

  const text = await res.text();
  const lines = text.split('\n');
  const samples = [];
  let meta = {};

  for (const line of lines) {
    if (line.startsWith('event:')) {
      const eventType = line.slice(6).trim();
      const nextLine = lines[lines.indexOf(line) + 1] || '';
      if (nextLine.startsWith('data:')) {
        try {
          const data = JSON.parse(nextLine.slice(5).trim());
          if (eventType === 'start') meta = { ...meta, ...data };
          else if (eventType === 'sample') samples.push(data);
          else if (eventType === 'summary') meta.summary = data;
          else if (eventType === 'done') meta.done = true;
        } catch {}
      }
    }
  }

  // Calcular estatísticas
  const validSamples = samples.filter(s => s.rtt_ms != null && s.rtt_ms >= 0);
  const rtts = validSamples.map(s => s.rtt_ms);
  const lost = samples.length - validSamples.length;
  const lossPct = samples.length > 0 ? (lost / samples.length) * 100 : 0;

  let avgRtt = 0, minRtt = 0, maxRtt = 0, jitter = 0;
  if (rtts.length > 0) {
    avgRtt = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    minRtt = Math.min(...rtts);
    maxRtt = Math.max(...rtts);
    if (rtts.length > 1) {
      const diffs = [];
      for (let i = 1; i < rtts.length; i++) diffs.push(Math.abs(rtts[i] - rtts[i-1]));
      jitter = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }
  }

  return {
    target,
    sent: samples.length,
    received: validSamples.length,
    lost,
    loss_pct: Math.round(lossPct * 10) / 10,
    rtt_min: Math.round(minRtt * 100) / 100,
    rtt_avg: Math.round(avgRtt * 100) / 100,
    rtt_max: Math.round(maxRtt * 100) / 100,
    rtt_jitter: Math.round(jitter * 100) / 100,
    mtu: meta.mtu || null,
    resolved_ip: meta.ip || meta.resolved || null,
    samples: validSamples.map(s => ({ seq: s.seq, rtt: s.rtt_ms })),
    timestamp: new Date().toISOString()
  };
}

// Traceroute via SSE
async function flowTraceroute(target) {
  const session = await getSession();
  const url = `${FLOW_BASE}/system-api/traceroute?ip=${encodeURIComponent(target)}`;

  const res = await fetch(url, {
    headers: {
      'Cookie': session.cookie,
      'X-CSRFToken': session.csrf
    }
  });

  if (!res.ok) throw new Error(`Traceroute failed: ${res.status}`);

  const text = await res.text();
  const lines = text.split('\n');
  const hops = [];
  let meta = {};

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('event:')) {
      const eventType = lines[i].slice(6).trim();
      const nextLine = lines[i + 1] || '';
      if (nextLine.startsWith('data:')) {
        try {
          const data = JSON.parse(nextLine.slice(5).trim());
          if (eventType === 'start') meta = { ...meta, ...data };
          else if (eventType === 'hop') hops.push(data);
          else if (eventType === 'done') meta.done = true;
        } catch {}
      }
    }
  }

  return {
    target,
    hops: hops.map(h => ({
      hop: h.hop || h.ttl,
      ip: h.ip || h.addr,
      rtt: h.rtt_ms || h.rtt,
      asn: h.asn,
      hostname: h.hostname || h.host
    })),
    timestamp: new Date().toISOString()
  };
}

// Formatar bps
function fmtBps(bps) {
  if (bps >= 1e9) return (bps / 1e9).toFixed(1) + ' Gbps';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  if (bps >= 1e3) return (bps / 1e3).toFixed(1) + ' Kbps';
  return bps.toFixed(0) + ' bps';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.query.action || 'overview';

    // === OVERVIEW: Tráfego consolidado de todas as fontes ===
    if (action === 'overview') {
      const minutes = parseInt(req.query.minutes) || 5;
      const results = await Promise.all(
        SOURCES.map(async (src) => {
          try {
            const data = await flowAPI('traffic-interfaces', { source: src, minutes });
            const series = data.series || {};
            const rxInterfaces = series.rx || [];
            const txInterfaces = series.tx || [];

            let totalRxBps = 0, totalTxBps = 0;
            const topRx = [];
            for (const iface of rxInterfaces) {
              const bpsArr = iface.data?.bps || [];
              const lastBps = bpsArr[bpsArr.length - 1] || 0;
              totalRxBps += lastBps;
              topRx.push({ ifIndex: iface.ifIndex, bps: lastBps });
            }
            for (const iface of txInterfaces) {
              const bpsArr = iface.data?.bps || [];
              const lastBps = bpsArr[bpsArr.length - 1] || 0;
              totalTxBps += lastBps;
            }

            return {
              source: src,
              rx_bps: totalRxBps,
              tx_bps: totalTxBps,
              rx_fmt: fmtBps(totalRxBps),
              tx_fmt: fmtBps(totalTxBps),
              total_fmt: fmtBps(totalRxBps + totalTxBps),
              top_interfaces: topRx.sort((a, b) => b.bps - a.bps).slice(0, 5)
            };
          } catch (e) {
            return { source: src, error: e.message };
          }
        })
      );

      // Tráfego por protocolo (Centro)
      let protoData = null;
      try {
        protoData = await flowAPI('traffic-proto', { source: 'ANB-BRAS01-MX204-CENTRO', minutes });
      } catch {}

      // Top AS
      let topAS = null;
      try {
        topAS = await flowAPI('traffic-as', { source: 'ANB-BRAS01-MX204-CENTRO', minutes });
      } catch {}

      const totalRx = results.reduce((sum, r) => sum + (r.rx_bps || 0), 0);
      const totalTx = results.reduce((sum, r) => sum + (r.tx_bps || 0), 0);

      return res.json({
        timestamp: new Date().toISOString(),
        sources: results,
        total_rx_bps: totalRx,
        total_tx_bps: totalTx,
        total_rx_fmt: fmtBps(totalRx),
        total_tx_fmt: fmtBps(totalTx),
        protocols: protoData,
        top_as: topAS
      });
    }

    // === TRAFFIC: Dados detalhados de uma fonte ===
    if (action === 'traffic') {
      const source = req.query.source || SOURCES[0];
      const type = req.query.type || 'interfaces';
      const minutes = parseInt(req.query.minutes) || 5;
      const data = await flowAPI(`traffic-${type}`, { source, minutes });
      return res.json(data);
    }

    // === PING: Medição ativa via Flow server ===
    if (action === 'ping') {
      const target = req.query.target || '8.8.8.8';
      const count = parseInt(req.query.count) || 5;
      const result = await flowPing(target, count);
      return res.json(result);
    }

    // === TRACEROUTE: Rota via Flow server ===
    if (action === 'traceroute') {
      const target = req.query.target || '8.8.8.8';
      const result = await flowTraceroute(target);
      return res.json(result);
    }

    // === MULTI-PING: Ping em múltiplos alvos ===
    if (action === 'multi-ping') {
      const targets = (req.query.targets || '8.8.8.8,1.1.1.1,143.137.32.3,143.137.32.6,100.65.0.116')
        .split(',').map(t => t.trim()).filter(Boolean);
      const count = parseInt(req.query.count) || 4;
      const results = await Promise.all(
        targets.map(t => flowPing(t, count).catch(e => ({
          target: t, error: e.message, received: 0, lost: count, loss_pct: 100
        })))
      );
      return res.json({
        timestamp: new Date().toISOString(),
        results
      });
    }

    // === SOURCES: Lista de fontes disponíveis ===
    if (action === 'sources') {
      return res.json({ sources: SOURCES });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('Flow proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
