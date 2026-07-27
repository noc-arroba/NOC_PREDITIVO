// ============================================================
// NOC PREDITIVO — Scanner de Rede /22 (com debug)
// ============================================================

function genBlock(prefix, octets) {
  const ips = [];
  for (const oct of octets) {
    for (let j = 0; j < 256; j++) {
      ips.push(`${prefix}.${oct}.${j}`);
    }
  }
  return ips;
}

// IPs conhecidos da Arroba
const IPS_CONHECIDOS = [
  '143.137.32.1', '143.137.32.2', '143.137.32.3', '143.137.32.4',
  '143.137.32.5', '143.137.32.7', '143.137.32.8', '143.137.32.9',
  '143.137.32.10', '143.137.32.11', '143.137.32.12', '143.137.32.13',
  '143.137.32.14', '143.137.32.15', '143.137.32.16', '143.137.32.17',
  '143.137.32.18', '143.137.32.19', '143.137.32.20',
  '168.197.56.1', '168.197.56.2', '168.197.56.3', '168.197.56.4',
];

// Sub-range do /22 (primeiros 32 de cada bloco)
const IPS_RANGE = [
  ...genBlock('143.137.32', [32]).slice(0, 64),
  ...genBlock('143.137.32', [33]).slice(0, 64),
  ...genBlock('143.137.32', [34]).slice(0, 64),
  ...genBlock('143.137.32', [35]).slice(0, 64),
  ...genBlock('168.197.56', [56]).slice(0, 64),
  ...genBlock('168.197.56', [57]).slice(0, 64),
  ...genBlock('168.197.56', [58]).slice(0, 64),
  ...genBlock('168.197.56', [59]).slice(0, 64),
];

const PORTAS_DETALHADO = [
  { porta: 21, servico: 'FTP', risco: 'alto', descricao: 'FTP — texto puro' },
  { porta: 22, servico: 'SSH', risco: 'alto', descricao: 'SSH' },
  { porta: 23, servico: 'Telnet', risco: 'critico', descricao: 'Telnet — VULNERÁVEL' },
  { porta: 25, servico: 'SMTP', risco: 'medio', descricao: 'E-mail envio' },
  { porta: 53, servico: 'DNS', risco: 'baixo', descricao: 'DNS' },
  { porta: 80, servico: 'HTTP', risco: 'medio', descricao: 'Web sem HTTPS' },
  { porta: 110, servico: 'POP3', risco: 'medio', descricao: 'E-mail sem crypto' },
  { porta: 143, servico: 'IMAP', risco: 'medio', descricao: 'E-mail sem crypto' },
  { porta: 161, servico: 'SNMP', risco: 'alto', descricao: 'Gerência de rede' },
  { porta: 389, servico: 'LDAP', risco: 'alto', descricao: 'Diretório sem crypto' },
  { porta: 443, servico: 'HTTPS', risco: 'baixo', descricao: 'Web criptografada' },
  { porta: 445, servico: 'SMB/CIFS', risco: 'critico', descricao: 'Windows — ransomware' },
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
  { porta: 9200, servico: 'Elasticsearch', risco: 'critico', descricao: 'Elasticsearch sem auth' },
  { porta: 27017, servico: 'MongoDB', risco: 'critico', descricao: 'MongoDB' },
  { porta: 5555, servico: 'ADB', risco: 'alto', descricao: 'Android Debug' },
];

function checkPort(ip, porta, timeout = 3000) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    let resolved = false;
    
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };
    
    socket.on('connect', () => done({ open: true }));
    socket.on('timeout', () => done({ open: false, error: 'timeout' }));
    socket.on('error', (err) => done({ open: false, error: err.code || err.message }));
    
    try {
      socket.connect(porta, ip);
    } catch (e) {
      done({ open: false, error: e.message });
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();
  const debug = req.query.debug === '1';

  try {
    // Step 1: Testar IPs conhecidos primeiro (conexão confirmada)
    const knownResults = [];
    for (const ip of IPS_CONHECIDOS) {
      const portas = [80, 443, 22, 3389, 161, 8080];
      const results = await Promise.all(
        portas.map(async p => ({ porta: p, ...(await checkPort(ip, p, 3000)) }))
      );
      const abertas = results.filter(r => r.open);
      knownResults.push({ ip, portas_testadas: results, portas_abertas: abertas });
    }

    // Step 2: Discovery no range (64 IPs por /24 = 512 total)
    const discoveryPortas = [80, 443, 22, 3389];
    let tested = 0;
    const hostMap = {};

    for (let i = 0; i < IPS_RANGE.length; i += 50) {
      const batch = IPS_RANGE.slice(i, i + 50);
      const batchResults = await Promise.all(
        batch.map(async ip => {
          const portResults = await Promise.all(
            discoveryPortas.map(async p => ({ porta: p, open: (await checkPort(ip, p, 3000)).open }))
          );
          const anyOpen = portResults.some(r => r.open);
          tested++;
          return { ip, alive: anyOpen, portResults };
        })
      );
      for (const r of batchResults) {
        if (r.alive) hostMap[r.ip] = r.portResults.filter(p => p.open).map(p => p.porta);
      }
    }

    // Adicionar hosts conhecidos que já sabemos que estão ativos
    for (const kr of knownResults) {
      if (kr.portas_abertas.length > 0) {
        if (!hostMap[kr.ip]) {
          hostMap[kr.ip] = kr.portas_abertas.map(p => p.porta);
        }
      }
    }

    const hostsAtivos = Object.keys(hostMap).sort();

    // Step 3: Scan detalhado nos hosts ativos
    const detalheScan = [];
    for (const ip of hostsAtivos) {
      const portasResults = await Promise.all(
        PORTAS_DETALHADO.map(async p => ({
          ...p,
          aberta: (await checkPort(ip, p.porta, 3000)).open
        }))
      );

      const abertas = portasResults.filter(p => p.aberta);
      const critica = abertas.filter(p => p.risco === 'critico');
      const alta = abertas.filter(p => p.risco === 'alto');

      detalheScan.push({
        ip,
        bloco: ip.startsWith('143.137') ? '143.137.32.0/22' : '168.197.56.0/22',
        portas_abertas: abertas.length,
        portas_criticas: critica.length,
        portas_altas: alta.length,
        portas: portasResults,
        detalhe_abertas: abertas,
      });
    }

    // Score
    let score = 100;
    for (const host of detalheScan) {
      score -= host.portas_criticas * 15;
      score -= host.portas_altas * 8;
      score -= host.portas_abertas * 2;
    }
    score = Math.max(0, Math.min(100, score));

    // Recomendações
    const recomendacoes = [];
    for (const host of detalheScan) {
      for (const p of host.detalhe_abertas) {
        if (p.risco === 'critico') {
          recomendacoes.push({
            severity: 'critico',
            ip: host.ip,
            porta: `${p.porta}/${p.servico}`,
            acao: `FECHAR IMEDIATAMENTE: ${p.descricao}. ${p.servico} em ${host.ip} está acessível pela internet. Bloquear via firewall.`
          });
        } else if (p.risco === 'alto') {
          recomendacoes.push({
            severity: 'alto',
            ip: host.ip,
            porta: `${p.porta}/${p.servico}`,
            acao: `${p.servico} em ${host.ip} exposto. ${p.descricaoy}. Restringir via ACL/VPN.`
          });
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      timestamp: new Date().toISOString(),
      duration_seconds: parseFloat(elapsed),
      blocos: ['143.137.32.0/22 (512 IPs)', '168.197.56.0/22 (512 IPs)'],
      total_ips_discovery: IPS_RANGE.length,
      total_ips_conhecidos: IPS_CONHECIDOS.length,
      hosts_ativos: hostsAtivos.length,
      hosts_ativos_lista: hostsAtivos,
      score_seguranca: score,
      portas_criticas_total: detalheScan.reduce((s, h) => s + h.portas_criticas, 0),
      portas_altas_total: detalheScan.reduce((s, h) => s + h.portas_altas, 0),
      portas_abertas_total: detalheScan.reduce((s, h) => s + h.portas_abertas, 0),
      hosts: detalheScan,
      recomendacoes: recomendacoes.sort((a, b) => {
        const order = { critico: 0, alto: 1 };
        return (order[a.severity] || 9) - (order[b.severity] || 9);
      }),
      debug: debug ? {
        knownResults: knownResults.map(r => ({
          ip: r.ip,
          abertas: r.portas_abertas.map(p => `${p.porta}`),
          errors: r.portas_testadas.filter(p => !p.open).map(p => ({ porta: p.porta, error: p.error }))
        }))
      } : undefined,
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
};
