// NOC PREDITIVO — Scanner por bloco /24
// Aceita ?block=143.137.32 ou ?block=168.197.56 etc.
// Sem block, lista os 8 blocos disponíveis.

const BLOCOS = [
  { cidr: '143.137.32.0/24', prefix: '143.137.32', nome: 'Bloco 1 /22 Arroba — .32' },
  { cidr: '143.137.33.0/24', prefix: '143.137.33', nome: 'Bloco 1 /22 Arroba — .33' },
  { cidr: '143.137.34.0/24', prefix: '143.137.34', nome: 'Bloco 1 /22 Arroba — .34' },
  { cidr: '143.137.35.0/24', prefix: '143.137.35', nome: 'Bloco 1 /22 Arroba — .35' },
  { cidr: '168.197.56.0/24', prefix: '168.197.56', nome: 'Bloco 2 /22 Arroba — .56' },
  { cidr: '168.197.57.0/24', prefix: '168.197.57', nome: 'Bloco 2 /22 Arroba — .57' },
  { cidr: '168.197.58.0/24', prefix: '168.197.58', nome: 'Bloco 2 /22 Arroba — .58' },
  { cidr: '168.197.59.0/24', prefix: '168.197.59', nome: 'Bloco 2 /22 Arroba — .59' },
];

const PORTAS_DISCOVERY = [80, 443, 22, 3389, 161, 8080];

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

  // Sem parâmetro block → listar blocos disponíveis
  const blockParam = req.query.block;
  if (!blockParam) {
    return res.json({
      blocos_disponiveis: BLOCOS.map((b, i) => ({
        id: i,
        cidr: b.cidr,
        nome: b.nome,
        total_ips: 256,
        url: `/api/scan-network?block=${b.prefix}`
      })),
      total_blocos: BLOCOS.length,
      total_ips: BLOCOS.length * 256,
    });
  }

  // Encontrar o bloco solicitado
  const bloco = BLOCOS.find(b => b.prefix === blockParam);
  if (!bloco) {
    return res.status(400).json({
      erro: 'Bloco nao encontrado',
      blocos_validos: BLOCOS.map(b => b.prefix)
    });
  }

  const startTime = Date.now();

  try {
    // Gerar 256 IPs do /24
    const ips = [];
    for (let i = 0; i < 256; i++) {
      ips.push(`${bloco.prefix}.${i}`);
    }

    // === Phase 1: Discovery — tentar portas sequencialmente por IP, batches de 40 ===
    const hostMap = {};
    const BATCH = 40;

    for (let i = 0; i < ips.length; i += BATCH) {
      const batch = ips.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async ip => {
          for (const porta of PORTAS_DISCOVERY) {
            const result = await checkPort(ip, porta, 3000);
            if (result.open) return { ip, alive: true, porta };
          }
          return { ip, alive: false };
        })
      );
      for (const r of results) {
        if (r.alive) hostMap[r.ip] = [r.porta];
      }
    }

    const hostsAtivos = Object.keys(hostMap).sort();

    // === Phase 2: Scan detalhado nos hosts ativos ===
    const detalheScan = [];
    for (const ip of hostsAtivos) {
      const portasResults = await Promise.all(
        PORTAS_DETALHADO.map(async p => ({
          ...p, aberta: (await checkPort(ip, p.porta, 3000)).open
        }))
      );
      const abertas = portasResults.filter(p => p.aberta);
      detalheScan.push({
        ip,
        bloco: bloco.cidr,
        portas_abertas: abertas.length,
        portas_criticas: abertas.filter(p => p.risco === 'critico').length,
        portas_altas: abertas.filter(p => p.risco === 'alto').length,
        detalhe_abertas: abertas,
      });
    }

    // Recomendações
    const recomendacoes = [];
    for (const h of detalheScan) {
      for (const p of h.detalhe_abertas) {
        recomendacoes.push({
          severity: p.risco,
          ip: h.ip,
          bloco: h.bloco,
          porta: `${p.porta}/${p.servico}`,
          acao: p.risco === 'critico'
            ? `FECHAR IMEDIATAMENTE: ${p.descricao} em ${h.ip} (${h.bloco}). Bloquear via firewall.`
            : `${p.servico} em ${h.ip} (${h.bloco}) exposto. ${p.descricaoy || p.descricao}. Restringir via ACL/VPN.`
        });
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    res.json({
      bloco: bloco.cidr,
      nome: bloco.nome,
      timestamp: new Date().toISOString(),
      duration_seconds: parseFloat(elapsed),
      total_ips: 256,
      hosts_ativos: hostsAtivos.length,
      hosts_inativos: 256 - hostsAtivos.length,
      hosts_ativos_lista: hostsAtivos,
      portas_abertas_total: detalheScan.reduce((s, h) => s + h.portas_abertas, 0),
      portas_criticas_total: detalheScan.reduce((s, h) => s + h.portas_criticas, 0),
      portas_altas_total: detalheScan.reduce((s, h) => s + h.portas_altas, 0),
      hosts: detalheScan,
      recomendacoes: recomendacoes.sort((a, b) => {
        const o = { critico: 0, alto: 1, medio: 2, baixo: 3 };
        return (o[a.severity] || 9) - (o[b.severity] || 9);
      }),
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
};
