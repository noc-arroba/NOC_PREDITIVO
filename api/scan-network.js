// NOC PREDITIVO — Scanner COMPLETO com debug de erros
function genBlock(prefix, octets) {
  const ips = [];
  for (const oct of octets) {
    for (let j = 0; j < 256; j++) ips.push(`${prefix}.${oct}.${j}`);
  }
  return ips;
}

const TODOS_IPS = [
  ...genBlock('143.137.32', [32, 33, 34, 35]),
  ...genBlock('168.197.56', [56, 57, 58, 59]),
];

const PORTAS_DISCOVERY = [80, 443, 22, 3389, 161];

const PORTAS_DETALHADO = [
  { porta: 21, servico: 'FTP', risco: 'alto', descricao: 'FTP texto puro' },
  { porta: 22, servico: 'SSH', risco: 'alto', descricao: 'SSH' },
  { porta: 23, servico: 'Telnet', risco: 'critico', descricao: 'Telnet VULNERAVEL' },
  { porta: 25, servico: 'SMTP', risco: 'medio', descricao: 'Email envio' },
  { porta: 53, servico: 'DNS', risco: 'baixo', descricao: 'DNS' },
  { porta: 80, servico: 'HTTP', risco: 'medio', descricao: 'Web sem HTTPS' },
  { porta: 110, servico: 'POP3', risco: 'medio', descricao: 'Email sem crypto' },
  { porta: 143, servico: 'IMAP', risco: 'medio', descricao: 'Email sem crypto' },
  { porta: 161, servico: 'SNMP', risco: 'alto', descricao: 'Gerencia rede' },
  { porta: 389, servico: 'LDAP', risco: 'alto', descricao: 'Diretorio sem crypto' },
  { porta: 443, servico: 'HTTPS', risco: 'baixo', descricao: 'Web criptografada' },
  { porta: 445, servico: 'SMB', risco: 'critico', descricao: 'Windows ransomware' },
  { porta: 465, servico: 'SMTPS', risco: 'baixo', descricao: 'SMTP criptografado' },
  { porta: 587, servico: 'SMTP Auth', risco: 'baixo', descricao: 'SMTP autenticado' },
  { porta: 636, servico: 'LDAPS', risco: 'baixo', descricao: 'LDAP criptografado' },
  { porta: 993, servico: 'IMAPS', risco: 'baixo', descricao: 'IMAP criptografado' },
  { porta: 995, servico: 'POP3S', risco: 'baixo', descricao: 'POP3 criptografado' },
  { porta: 1433, servico: 'MSSQL', risco: 'critico', descricao: 'Banco MS SQL' },
  { porta: 1723, servico: 'PPTP', risco: 'alto', descricao: 'VPN antigo' },
  { porta: 3306, servico: 'MySQL', risco: 'critico', descricao: 'Banco MySQL' },
  { porta: 3389, servico: 'RDP', risco: 'critico', descricao: 'Remote Desktop' },
  { porta: 5432, servico: 'PostgreSQL', risco: 'critico', descricao: 'Banco PostgreSQL' },
  { porta: 5900, servico: 'VNC', risco: 'alto', descricao: 'VNC' },
  { porta: 6379, servico: 'Redis', risco: 'critico', descricao: 'Redis sem auth' },
  { porta: 6443, servico: 'K8s API', risco: 'alto', descricao: 'Kubernetes' },
  { porta: 7547, servico: 'CWMP', risco: 'medio', descricao: 'TR-069 CPE' },
  { porta: 8080, servico: 'HTTP Alt', risco: 'medio', descricao: 'Web alternativo' },
  { porta: 8443, servico: 'HTTPS Alt', risco: 'medio', descricao: 'HTTPS alternativo' },
  { porta: 9000, servico: 'PHP-FPM', risco: 'alto', descricao: 'PHP FastCGI' },
  { porta: 9090, servico: 'Prometheus', risco: 'medio', descricao: 'Monitoramento' },
  { porta: 9200, servico: 'Elasticsearch', risco: 'critico', descricao: 'Elasticsearch' },
  { porta: 27017, servico: 'MongoDB', risco: 'critico', descricao: 'MongoDB' },
  { porta: 5555, servico: 'ADB', risco: 'alto', descricao: 'Android Debug' },
];

function checkPort(ip, porta, timeout = 3000) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    let resolved = false;
    const done = (r) => { if (!resolved) { resolved = true; try { socket.destroy(); } catch {} resolve(r); } };
    socket.on('connect', () => done({ open: true }));
    socket.on('timeout', () => done({ open: false, error: 'timeout' }));
    socket.on('error', (err) => done({ open: false, error: err.code || err.message }));
    try { socket.connect(porta, ip); } catch (e) { done({ open: false, error: e.message }); }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();
  const debug = req.query.debug === '1';
  const limit = parseInt(req.query.limit) || 0; // 0 = all

  try {
    // IPs para escanear (com limite opcional para debug)
    const ipsToScan = limit > 0 ? TODOS_IPS.slice(0, limit) : TODOS_IPS;

    // DEBUG: Testar IP conhecido primeiro
    if (debug) {
      const testResult = await checkPort('143.137.32.7', 443, 3000);
      const testResult2 = await checkPort('143.137.32.8', 80, 3000);
      const testResult3 = await checkPort('143.137.32.14', 23, 3000);
      console.log('Debug tests:', JSON.stringify({ test1: testResult, test2: testResult2, test3: testResult3 }));
    }

    // === Discovery: 1 porta por vez por IP, parar no primeiro sucesso ===
    // Batches de 40 IPs, 1 porta por vez = 40 conexões concorrentes
    const hostMap = {};
    const errorLog = [];
    const BATCH = 40;

    for (let i = 0; i < ipsToScan.length; i += BATCH) {
      const batch = ipsToScan.slice(i, i + BATCH);

      const batchResults = await Promise.all(
        batch.map(async ip => {
          // Tentar portas sequencialmente, parar no primeiro sucesso
          for (const porta of PORTAS_DISCOVERY) {
            const result = await checkPort(ip, porta, 3000);
            if (result.open) {
              return { ip, alive: true, porta };
            }
            // Log de erros para os primeiros IPs (debug)
            if (debug && errorLog.length < 20 && i < 200) {
              errorLog.push({ ip, porta, error: result.error });
            }
          }
          return { ip, alive: false };
        })
      );

      for (const r of batchResults) {
        if (r.alive) hostMap[r.ip] = [r.porta];
      }
    }

    const hostsAtivos = Object.keys(hostMap).sort((a, b) => {
      const aP = a.split('.').map(Number), bP = b.split('.').map(Number);
      for (let i = 0; i < 4; i++) if (aP[i] !== bP[i]) return aP[i] - bP[i];
      return 0;
    });

    // === Scan detalhado ===
    const detalheScan = [];
    for (const ip of hostsAtivos) {
      const portasResults = await Promise.all(
        PORTAS_DETALHADO.map(async p => ({ ...p, aberta: (await checkPort(ip, p.porta, 3000)).open }))
      );
      const abertas = portasResults.filter(p => p.aberta);
      detalheScan.push({
        ip,
        bloco: ip.startsWith('143.137') ? '143.137.32.0/22' : '168.197.56.0/22',
        portas_abertas: abertas.length,
        portas_criticas: abertas.filter(p => p.risco === 'critico').length,
        portas_altas: abertas.filter(p => p.risco === 'alto').length,
        detalhe_abertas: abertas,
      });
    }

    let score = 100;
    for (const h of detalheScan) { score -= h.portas_criticas * 15; score -= h.portas_altas * 8; score -= h.portas_abertas * 2; }
    score = Math.max(0, Math.min(100, score));

    const recomendacoes = [];
    for (const h of detalheScan) {
      for (const p of h.detalhe_abertas) {
        recomendacoes.push({
          severity: p.risco, ip: h.ip, bloco: h.bloco, porta: `${p.porta}/${p.servico}`,
          acao: p.risco === 'critico' ? `FECHAR: ${p.descricao} em ${h.ip}` : `${p.servico} em ${h.ip} exposto`
        });
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      timestamp: new Date().toISOString(),
      duration_seconds: parseFloat(elapsed),
      total_ips_escaneados: ipsToScan.length,
      hosts_ativos: hostsAtivos.length,
      hosts_inativos: ipsToScan.length - hostsAtivos.length,
      hosts_ativos_lista: hostsAtivos,
      score_seguranca: score,
      portas_abertas_total: detalheScan.reduce((s, h) => s + h.portas_abertas, 0),
      portas_criticas_total: detalheScan.reduce((s, h) => s + h.portas_criticas, 0),
      portas_altas_total: detalheScan.reduce((s, h) => s + h.portas_altas, 0),
      hosts: detalheScan,
      recomendacoes: recomendacoes.sort((a, b) => {
        const o = { critico: 0, alto: 1, medio: 2, baixo: 3 };
        return (o[a.severity] || 9) - (o[b.severity] || 9);
      }),
      debug: debug ? {
        error_sample: errorLog.slice(0, 10),
        ips_tested: ipsToScan.length,
        note: `Scanned ${ipsToScan.length} IPs in ${elapsed}s`
      } : undefined,
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
};
