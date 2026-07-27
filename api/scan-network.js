// ============================================================
// NOC PREDITIVO — Scanner Completo de Rede /22
// Phase 1: Discovery (todos os IPs) → Phase 2: Port scan (hosts ativos)
// ============================================================

// Gerar todos os IPs de um bloco CIDR /22
function generateIPs(base, startOctet) {
  const ips = [];
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      ips.push(`${base}.${startOctet + i}.${j}`);
    }
  }
  return ips;
}

// 143.137.32.0/22 → .32.x, .33.x, .34.x, .35.x
// 168.197.56.0/22 → .56.x, .57.x, .58.x, .59.x
const BLOCO_1 = generateIPs('143.137.32', 32).concat(
  generateIPs('143.137.32', 33),
  generateIPs('143.137.32', 34),
  generateIPs('143.137.32', 35)
);
// Fix: generateIPs needs proper base
function genBlock(prefix, octets) {
  const ips = [];
  for (const oct of octets) {
    for (let j = 0; j < 256; j++) {
      ips.push(`${prefix}.${oct}.${j}`);
    }
  }
  return ips;
}

const TODOS_IPS = [
  ...genBlock('143.137.32', [32, 33, 34, 35]),
  ...genBlock('168.197.56', [56, 57, 58, 59]),
];

// Portas para discovery (rápido — só descobrir hosts ativos)
const PORTAS_DISCOVERY = [80, 443, 22, 3389, 161];

// Portas para scan detalhado (em hosts confirmados ativos)
const PORTAS_DETALHADO = [
  { porta: 21, servico: 'FTP', risco: 'alto', descricao: 'Transferência de arquivos — texto puro' },
  { porta: 22, servico: 'SSH', risco: 'alto', descricao: 'Acesso remoto criptografado' },
  { porta: 23, servico: 'Telnet', risco: 'critico', descricao: 'Acesso remoto em texto puro — VULNERÁVEL' },
  { porta: 25, servico: 'SMTP', risco: 'medio', descricao: 'Envio de e-mail' },
  { porta: 53, servico: 'DNS', risco: 'baixo', descricao: 'Resolução de nomes' },
  { porta: 80, servico: 'HTTP', risco: 'medio', descricao: 'Web sem criptografia' },
  { porta: 110, servico: 'POP3', risco: 'medio', descricao: 'E-mail sem criptografia' },
  { porta: 143, servico: 'IMAP', risco: 'medio', descricao: 'E-mail sem criptografia' },
  { porta: 161, servico: 'SNMP', risco: 'alto', descricao: 'Gerência de rede — exposição de dados' },
  { porta: 389, servico: 'LDAP', risco: 'alto', descricao: 'Diretório sem criptografia' },
  { porta: 443, servico: 'HTTPS', risco: 'baixo', descricao: 'Web criptografada' },
  { porta: 445, servico: 'SMB/CIFS', risco: 'critico', descricao: 'Compartilhamento Windows — ransomware' },
  { porta: 465, servico: 'SMTPS', risco: 'baixo', descricao: 'Envio de e-mail criptografado' },
  { porta: 587, servico: 'SMTP Submission', risco: 'baixo', descricao: 'Envio autenticado' },
  { porta: 636, servico: 'LDAPS', risco: 'baixo', descricao: 'Diretório criptografado' },
  { porta: 993, servico: 'IMAPS', risco: 'baixo', descricao: 'E-mail criptografado' },
  { porta: 995, servico: 'POP3S', risco: 'baixo', descricao: 'E-mail criptografado' },
  { porta: 1433, servico: 'MSSQL', risco: 'critico', descricao: 'Banco de dados — nunca expor' },
  { porta: 1723, servico: 'PPTP', risco: 'alto', descricao: 'VPN antigo — vulnerável' },
  { porta: 3306, servico: 'MySQL', risco: 'critico', descricao: 'Banco de dados — nunca expor' },
  { porta: 3389, servico: 'RDP', risco: 'critico', descricao: 'Remote Desktop — brute force' },
  { porta: 5432, servico: 'PostgreSQL', risco: 'critico', descricao: 'Banco de dados — nunca expor' },
  { porta: 5900, servico: 'VNC', risco: 'alto', descricao: 'Acesso remoto gráfico' },
  { porta: 6379, servico: 'Redis', risco: 'critico', descricao: 'Cache — sem auth por padrão' },
  { porta: 6443, servico: 'K8s API', risco: 'alto', descricao: 'Kubernetes' },
  { porta: 7547, servico: 'CWMP', risco: 'medio', descricao: 'TR-069 — gerência de CPEs' },
  { porta: 8080, servico: 'HTTP Alt', risco: 'medio', descricao: 'Web alternativo' },
  { porta: 8443, servico: 'HTTPS Alt', risco: 'medio', descricao: 'Web criptografado alternativo' },
  { porta: 9000, servico: 'PHP-FPM', risco: 'alto', descricao: 'PHP FastCGI' },
  { porta: 9090, servico: 'Prometheus', risco: 'medio', descricao: 'Monitoramento' },
  { porta: 9200, servico: 'Elasticsearch', risco: 'critico', descricao: 'Busca — sem auth por padrão' },
  { porta: 27017, servico: 'MongoDB', risco: 'critico', descricao: 'Banco NoSQL — nunca expor' },
  { porta: 5555, servico: 'ADB', risco: 'alto', descricao: 'Android Debug Bridge' },
];

function checkPort(ip, porta, timeout = 800) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.connect(porta, ip);
  });
}

// Processar em batches com concorrência controlada
async function scanBatch(ips, portas, concurrency = 150, timeout = 800) {
  const results = [];
  const tasks = [];
  for (const ip of ips) {
    for (const porta of portas) {
      tasks.push({ ip, porta });
    }
  }

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async t => ({
        ip: t.ip,
        porta: t.porta,
        open: await checkPort(t.ip, t.porta, timeout)
      }))
    );
    results.push(...batchResults);
  }
  return results;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const phase = req.query.phase || 'all';
  const startTime = Date.now();

  try {
    // Phase 1: Discovery — scan all 2048 IPs with a few common ports
    const discoveryResults = await scanBatch(TODOS_IPS, PORTAS_DISCOVERY, 200, 600);

    // Encontrar hosts ativos (pelo menos 1 porta aberta)
    const hostMap = {};
    for (const r of discoveryResults) {
      if (r.open) {
        if (!hostMap[r.ip]) hostMap[r.ip] = [];
        hostMap[r.ip].push(r.porta);
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

    // Phase 2: Full port scan on alive hosts
    const detalheScan = [];
    if (hostsAtivos.length > 0 && phase !== 'discover') {
      const fullResults = await scanBatch(hostsAtivos, PORTAS_DETALHADO.map(p => p.porta), 100, 1500);

      // Agrupar por IP
      const fullMap = {};
      for (const r of fullResults) {
        if (!fullMap[r.ip]) fullMap[r.ip] = [];
        const portaInfo = PORTAS_DETALHADO.find(p => p.porta === r.porta);
        fullMap[r.ip].push({
          ...portaInfo,
          aberta: r.open
        });
      }

      for (const ip of hostsAtivos) {
        const portas = fullMap[ip] || [];
        const abertas = portas.filter(p => p.aberta);
        const critica = abertas.filter(p => p.risco === 'critico');
        const alta = abertas.filter(p => p.risco === 'alto');

        detalheScan.push({
          ip,
          bloco: ip.startsWith('143.137') ? '143.137.32.0/22' : '168.197.56.0/22',
          portas_abertas: abertas.length,
          portas_criticas: critica.length,
          portas_altas: alta.length,
          portas: portas,
          detalhe_abertas: abertas,
        });
      }
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
            acao: `FECHAR IMEDIATAMENTE: ${p.descricao}. ${p.servico} em ${host.ip} está acessível pela internet. Bloquear via firewall, permitir apenas VPN/rede interna.`
          });
        } else if (p.risco === 'alto') {
          recomendacoes.push({
            severity: 'alto',
            ip: host.ip,
            porta: `${p.porta}/${p.servico}`,
            acao: `${p.servico} em ${host.ip} exposto. ${p.descricao}. Restringir acesso via ACL/VPN.`
          });
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      timestamp: new Date().toISOString(),
      duration_seconds: parseFloat(elapsed),
      blocos: ['143.137.32.0/22', '168.197.56.0/22'],
      total_ips_escaneados: TODOS_IPS.length,
      hosts_ativos: hostsAtivos.length,
      hosts_inativos: TODOS_IPS.length - hostsAtivos.length,
      score_seguranca: score,
      portas_criticas_total: detalheScan.reduce((s, h) => s + h.portas_criticas, 0),
      portas_altas_total: detalheScan.reduce((s, h) => s + h.portas_altas, 0),
      portas_abertas_total: detalheScan.reduce((s, h) => s + h.portas_abertas, 0),
      hosts: detalheScan,
      hosts_ativos_lista: hostsAtivos,
      recomendacoes: recomendacoes.sort((a, b) => {
        const order = { critico: 0, alto: 1 };
        return (order[a.severity] || 9) - (order[b.severity] || 9);
      }),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};
