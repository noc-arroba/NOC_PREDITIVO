// ============================================================
// NOC PREDITIVO — Scanner COMPLETO dos 2 blocos /22 (2048 IPs)
// Discovery em batches para respeitar limites da Vercel
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

// Todos os 2048 IPs
const TODOS_IPS = [
  ...genBlock('143.137.32', [32, 33, 34, 35]),  // 1024 IPs
  ...genBlock('168.197.56', [56, 57, 58, 59]),  // 1024 IPs
];

// Portas para discovery (rápido)
const PORTAS_DISCOVERY = [80, 443, 22, 3389, 161];

// Portas para scan detalhado
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

function checkPort(ip, porta, timeout = 2500) {
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

// Discovery: scan 1 porta por vez por IP, parando no primeiro sucesso
async function discoverHost(ip, timeout = 2500) {
  for (const porta of PORTAS_DISCOVERY) {
    const result = await checkPort(ip, porta, timeout);
    if (result.open) return { ip, alive: true, porta };
  }
  return { ip, alive: false };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const startTime = Date.now();

  try {
    // === Phase 1: Discovery — todos os 2048 IPs ===
    // Processar em batches de 80 IPs concorrentes
    const hostMap = {};
    let processed = 0;
    const BATCH_SIZE = 80;

    for (let i = 0; i < TODOS_IPS.length; i += BATCH_SIZE) {
      const batch = TODOS_IPS.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async ip => {
          // Tentar portas em paralelo (todas de uma vez, parar na primeira aberta)
          const portResults = await Promise.all(
            PORTAS_DISCOVERY.map(async p => ({ porta: p, ...(await checkPort(ip, p, 2500)) }))
          );
          const openPort = portResults.find(r => r.open);
          processed++;
          return { ip, alive: !!openPort, openPort: openPort?.porta };
        })
      );
      for (const r of results) {
        if (r.alive) hostMap[r.ip] = [r.openPort];
      }
    }

    const hostsAtivos = Object.keys(hostMap).sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
      }
      return 0;
    });

    // === Phase 2: Scan detalhado nos hosts ativos ===
    const detalheScan = [];

    for (const ip of hostsAtivos) {
      const portasResults = await Promise.all(
        PORTAS_DETALHADO.map(async p => ({
          ...p,
          aberta: (await checkPort(ip, p.porta, 2500)).open
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
        detalhe_abertas: abertas,
        portas: portasResults,
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
            bloco: host.bloco,
            porta: `${p.porta}/${p.servico}`,
            acao: `FECHAR IMEDIATAMENTE: ${p.descricao}. ${p.servico} em ${host.ip} (${host.bloco}) está acessível pela internet. Bloquear via firewall, permitir apenas VPN/rede interna.`
          });
        } else if (p.risco === 'alto') {
          recomendacoes.push({
            severity: 'alto',
            ip: host.ip,
            bloco: host.bloco,
            porta: `${p.porta}/${p.servico}`,
            acao: `${p.servico} em ${host.ip} (${host.bloco}) exposto. ${p.descricao}. Restringir via ACL/VPN.`
          });
        } else if (p.risco === 'medio') {
          recomendacoes.push({
            severity: 'medio',
            ip: host.ip,
            bloco: host.bloco,
            porta: `${p.porta}/${p.servico}`,
            acao: `${p.servico} em ${host.ip}. ${p.descricao}. Avaliar se precisa estar aberto.`
          });
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      timestamp: new Date().toISOString(),
      duration_seconds: parseFloat(elapsed),
      blocos: ['143.137.32.0/22 (1024 IPs)', '168.197.56.0/22 (1024 IPs)'],
      total_ips_escaneados: TODOS_IPS.length,
      hosts_ativos: hostsAtivos.length,
      hosts_inativos: TODOS_IPS.length - hostsAtivos.length,
      hosts_ativos_lista: hostsAtivos,
      score_seguranca: score,
      portas_abertas_total: detalheScan.reduce((s, h) => s + h.portas_abertas, 0),
      portas_criticas_total: detalheScan.reduce((s, h) => s + h.portas_criticas, 0),
      portas_altas_total: detalheScan.reduce((s, h) => s + h.portas_altas, 0),
      hosts: detalheScan,
      recomendacoes: recomendacoes.sort((a, b) => {
        const order = { critico: 0, alto: 1, medio: 2 };
        return (order[a.severity] || 9) - (order[b.severity] || 9);
      }),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
};
