// ============================================================
// NOC PREDITIVO — API de Segurança de Rede
// Scanner de portas abertas em IPs públicos + auditoria de hardening
// ============================================================

// IPs públicos conhecidos da Arroba Banda Larga
const IPS_PUBLICOS = [
  { ip: '143.137.32.1', nome: 'Gateway Edge 1', bloco: '143.137.32.0/22', tipo: 'roteador' },
  { ip: '143.137.32.3', nome: 'NAS Arroba 1', bloco: '143.137.32.0/22', tipo: 'servidor' },
  { ip: '143.137.32.7', nome: 'IXC Central', bloco: '143.137.32.0/22', tipo: 'servidor' },
  { ip: '143.137.32.2', nome: 'DNS Primário', bloco: '143.137.32.0/22', tipo: 'dns' },
  { ip: '143.137.32.4', nome: 'Radius/PPPoE', bloco: '143.137.32.0/22', tipo: 'servidor' },
  { ip: '143.137.32.5', nome: 'Web/Mail', bloco: '143.137.32.0/22', tipo: 'servidor' },
  { ip: '168.197.56.1', nome: 'Gateway Edge 2', bloco: '168.197.56.0/22', tipo: 'roteador' },
  { ip: '168.197.56.2', nome: 'Servidor Bloco 2', bloco: '168.197.56.0/22', tipo: 'servidor' },
];

// Portas comuns a verificar
const PORTAS_SCAN = [
  { porta: 22, servico: 'SSH', risco: 'alto', descricao: 'Acesso remoto criptografado' },
  { porta: 23, servico: 'Telnet', risco: 'critico', descricao: 'Acesso remoto em texto puro — VULNERÁVEL' },
  { porta: 25, servico: 'SMTP', risco: 'medio', descricao: 'Envio de e-mail' },
  { porta: 53, servico: 'DNS', risco: 'baixo', descricao: 'Resolução de nomes' },
  { porta: 80, servico: 'HTTP', risco: 'medio', descricao: 'Web sem criptografia' },
  { porta: 110, servico: 'POP3', risco: 'medio', descricao: 'Recebimento de e-mail sem criptografia' },
  { porta: 143, servico: 'IMAP', risco: 'medio', descricao: 'E-mail sem criptografia' },
  { porta: 161, servico: 'SNMP', risco: 'alto', descricao: 'Gerência de rede — exposição de dados' },
  { porta: 443, servico: 'HTTPS', risco: 'baixo', descricao: 'Web criptografada' },
  { porta: 445, servico: 'SMB/CIFS', risco: 'critico', descricao: 'Compartilhamento Windows — alvo de ransomware' },
  { porta: 587, servico: 'SMTP Submission', risco: 'baixo', descricao: 'Envio de e-mail autenticado' },
  { porta: 993, servico: 'IMAPS', risco: 'baixo', descricao: 'E-mail criptografado' },
  { porta: 995, servico: 'POP3S', risco: 'baixo', descricao: 'E-mail criptografado' },
  { porta: 3306, servico: 'MySQL', risco: 'critico', descricao: 'Banco de dados — nunca expor' },
  { porta: 3389, servico: 'RDP', risco: 'critico', descricao: 'Remote Desktop — alvo de brute force' },
  { porta: 5432, servico: 'PostgreSQL', risco: 'critico', descricao: 'Banco de dados — nunca expor' },
  { porta: 6443, servico: 'Kubernetes API', risco: 'alto', descricao: 'Orquestração de containers' },
  { porta: 8080, servico: 'HTTP Alt', risco: 'medio', descricao: 'Web alternativo (proxy/admin)' },
  { porta: 8443, servico: 'HTTPS Alt', risco: 'medio', descricao: 'Web criptografado alternativo' },
  { porta: 27017, servico: 'MongoDB', risco: 'critico', descricao: 'Banco NoSQL — nunca expor' },
];

function checkPort(ip, porta, timeout = 3000) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    const start = Date.now();

    socket.on('connect', () => {
      socket.destroy();
      resolve({ open: true, latency: Date.now() - start });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ open: false, latency: null, error: 'timeout' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ open: false, latency: null, error: err.code || err.message });
    });
    socket.connect(porta, ip);
  });
}

async function checkSSL(host) {
  try {
    const tls = require('tls');
    const result = await new Promise((resolve) => {
      const socket = tls.connect(443, host, { servername: host, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        const valid = socket.authorized;
        socket.destroy();
        resolve({
          valid,
          subject: cert?.subject?.CN || '',
          issuer: cert?.issuer?.O || '',
          valid_from: cert?.valid_from || '',
          valid_to: cert?.valid_to || '',
          days_remaining: cert?.valid_to ? Math.ceil((new Date(cert.valid_to) - Date.now()) / 86400000) : null
        });
      });
      socket.setTimeout(5000);
      socket.on('timeout', () => { socket.destroy(); resolve({ erro: 'timeout' }); });
      socket.on('error', (e) => resolve({ erro: e.message }));
    });
    return result;
  } catch (e) {
    return { erro: e.message };
  }
}

async function checkDNS(domain) {
  try {
    const dns = require('dns').promises;
    const [a, mx, txt, ns] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolveMx(domain),
      dns.resolveTxt(domain),
      dns.resolveNs(domain)
    ]);
    return {
      a: a.status === 'fulfilled' ? a.value : [],
      mx: mx.status === 'fulfilled' ? mx.value : [],
      txt: txt.status === 'fulfilled' ? txt.value : [],
      ns: ns.status === 'fulfilled' ? ns.value : [],
    };
  } catch (e) {
    return { erro: e.message };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. Escanear portas de todos os IPs públicos
    const scanResults = [];

    for (const ipInfo of IPS_PUBLICOS) {
      const portas = await Promise.all(
        PORTAS_SCAN.map(async (p) => {
          const result = await checkPort(ipInfo.ip, p.porta);
          return {
            porta: p.porta,
            servico: p.servico,
            risco: p.risco,
            descricao: p.descricao,
            aberta: result.open,
            latencia: result.latency,
            erro: result.error || null
          };
        })
      );

      const portasAbertas = portas.filter(p => p.aberta);
      const portasCriticas = portasAbertas.filter(p => p.risco === 'critico');
      const portasAltas = portasAbertas.filter(p => p.risco === 'alto');

      scanResults.push({
        ...ipInfo,
        portas: portas,
        portas_abertas: portasAbertas.length,
        portas_criticas: portasCriticas.length,
        portas_altas: portasAltas.length,
        detalhe_abertas: portasAbertas
      });
    }

    // 2. Auditoria SSL
    const sslAudit = await checkSSL('central.arrobabandalarga.com.br');

    // 3. Auditoria DNS
    const dnsAudit = await checkDNS('arrobabandalarga.com.br');

    // 4. Score de segurança
    let scoreSeg = 100;
    for (const ip of scanResults) {
      scoreSeg -= ip.portas_criticas * 15;
      scoreSeg -= ip.portas_altas * 8;
      scoreSeg -= ip.portas_abertas * 2;
    }
    if (sslAudit.erro) scoreSeg -= 10;
    else if (!sslAudit.valid) scoreSeg -= 5;
    if (sslAudit.days_remaining !== null && sslAudit.days_remaining < 30) scoreSeg -= 5;
    scoreSeg = Math.max(0, Math.min(100, scoreSeg));

    // 5. Recomendações
    const recomendacoes = [];

    // Portas críticas abertas
    for (const ip of scanResults) {
      for (const p of ip.detalhe_abertas) {
        if (p.risco === 'critico') {
          recomendacoes.push({
            severity: 'critico',
            tipo: 'Porta Crítica Exposta',
            ip: ip.ip,
            nome: ip.nome,
            porta: `${p.porta}/${p.servico}`,
            acao: `FECHAR IMEDIATAMENTE: ${p.descricao}. ${p.servico} em ${ip.ip} (${ip.nome}) está acessível pela internet. Usar firewall para bloquear acesso externo, permitir apenas via VPN/rede interna.`
          });
        }
      }
    }

    // SNMP aberto
    for (const ip of scanResults) {
      const snmp = ip.detalhe_abertas.find(p => p.servico === 'SNMP');
      if (snmp) {
        recomendacoes.push({
          severity: 'alto',
          tipo: 'SNMP Exposto',
          ip: ip.ip,
          nome: ip.nome,
          porta: '161/SNMP',
          acao: `SNMP aberto em ${ip.ip}. Restringir community string, usar SNMPv3 com AuthPriv, e permitir apenas hosts de gerência autorizados via ACL.`
        });
      }
    }

    // SSH aberto
    for (const ip of scanResults) {
      const ssh = ip.detalhe_abertas.find(p => p.servico === 'SSH');
      if (ssh) {
        recomendacoes.push({
          severity: 'medio',
          tipo: 'SSH Exposto',
          ip: ip.ip,
          nome: ip.nome,
          porta: '22/SSH',
          acao: `SSH em ${ip.ip}. Implementar: chave SSH (desabilitar senha), fail2ban, mudar porta padrão, AllowUsers/AllowGroups, e idealmente restringir via VPN.`
        });
      }
    }

    // HTTP sem HTTPS
    for (const ip of scanResults) {
      const http = ip.detalhe_abertas.find(p => p.servico === 'HTTP');
      const https = ip.detalhe_abertas.find(p => p.servico === 'HTTPS');
      if (http && !https) {
        recomendacoes.push({
          severity: 'medio',
          tipo: 'HTTP sem HTTPS',
          ip: ip.ip,
          nome: ip.nome,
          porta: '80/HTTP',
          acao: `${ip.ip} serve HTTP sem HTTPS. Implementar redirect 301 para HTTPS e obter certificado SSL (Let\'s Encrypt grátis).`
        });
      }
    }

    // SSL
    if (sslAudit.erro) {
      recomendacoes.push({
        severity: 'alto',
        tipo: 'SSL Indisponível',
        ip: 'central.arrobabandalarga.com.br',
        acao: 'Certificado SSL do IXC não responde. Verificar se HTTPS está habilitado no servidor web do IXC.'
      });
    } else if (!sslAudit.valid) {
      recomendacoes.push({
        severity: 'medio',
        tipo: 'SSL Inválido',
        ip: 'central.arrobabandalarga.com.br',
        acao: `Certificado SSL do IXC é inválido ou auto-assinado. Obter certificado válido (Let's Encrypt). Emissor atual: ${sslAudit.issuer || 'desconhecido'}`
      });
    } else if (sslAudit.days_remaining !== null && sslAudit.days_remaining < 30) {
      recomendacoes.push({
        severity: 'atencao',
        tipo: 'SSL Expirando',
        ip: 'central.arrobabandalarga.com.br',
        acao: `Certificado SSL expira em ${sslAudit.days_remaining} dias. Renovar antes do vencimento.`
      });
    }

    // DNS sem SPF/DKIM
    if (dnsAudit.txt && dnsAudit.txt.length > 0) {
      const hasSPF = dnsAudit.txt.some(t => t.join('').includes('spf1'));
      const hasDKIM = dnsAudit.txt.some(t => t.join('').includes('dkim'));
      if (!hasSPF) {
        recomendacoes.push({
          severity: 'medio',
          tipo: 'SPF Ausente',
          ip: 'arrobabandalarga.com.br',
          acao: 'Registro SPF não encontrado no DNS. Adicionar TXT "v=spf1 ip4:143.137.32.0/22 -all" para evitar spoofing de e-mail.'
        });
      }
    } else {
      recomendacoes.push({
        severity: 'medio',
        tipo: 'SPF/DKIM Ausente',
        ip: 'arrobabandalarga.com.br',
        acao: 'Nenhum registro TXT/SPF encontrado. Configurar SPF e DKIM no DNS para proteção contra spoofing e phishing.'
      });
    }

    const result = {
      timestamp: new Date().toISOString(),
      score_seguranca: scoreSeg,
      ips_escaneados: scanResults.length,
      total_portas_abertas: scanResults.reduce((s, ip) => s + ip.portas_abertas, 0),
      total_portas_criticas: scanResults.reduce((s, ip) => s + ip.portas_criticas, 0),
      total_portas_altas: scanResults.reduce((s, ip) => s + ip.portas_altas, 0),
      scan: scanResults,
      ssl: sslAudit,
      dns: dnsAudit,
      recomendacoes: recomendacoes.sort((a, b) => {
        const order = { critico: 0, alto: 1, medio: 2, atencao: 3 };
        return (order[a.severity] || 9) - (order[b.severity] || 9);
      }),
      guia_hardening: {
        titulo: 'Guia de Hardening para ISP',
        itens: [
          { categoria: 'Firewall/Edge', acoes: [
            'Bloquear toda entrada por padrão (default deny), liberar apenas serviços necessários',
            'Implementar ACL no roteador de borda para permitir SNMP apenas de IPs de gerência',
            'Rate limiting em sessões BGP (max-prefix, TTL security, GTSM)',
            'BCP38: filtrar source address spoofing na borda (uRPF)',
          ]},
          { categoria: 'Servidores', acoes: [
            'Fechar portas de banco de dados (3306, 5432, 27017) para internet',
            'Desabilitar Telnet (23) e usar apenas SSH com chave',
            'fail2ban em todos os servidores Linux',
            'Atualizar SO e serviços regularmente (patch management)',
            'Desabilitar SMB/CIFS (445) exposto à internet',
          ]},
          { categoria: 'OLTs/Rede Óptica', acoes: [
            'Configurar SNMPv3 com AuthPriv em todas as OLTs',
            'Restringir acesso SSH/Telnet das OLTs via VPN apenas',
            'Monitorar LOS vs dying-gasp via SNMP para diagnóstico de causa raiz',
            'Isolar VLAN de gerência das OLTs do tráfego de clientes',
          ]},
          { categoria: 'DNS/E-mail', acoes: [
            'Configurar SPF, DKIM e DMARC no DNS',
            'DNSSEC para proteção contra cache poisoning',
            'Fechar recursão DNS para IPs externos (resolver apenas para clientes)',
            'Implementar rDNS (PTR) para IPs de servidores',
          ]},
          { categoria: 'Monitoramento', acoes: [
            'SIEM para correlacionar logs de firewall, servers e OLTs',
            'Alertas em tempo real para portas críticas que abrirem',
            'Backup offsite criptografado com rotação 3-2-1',
            'Auditoria periódica de portas (mensal) e pentest (semestral)',
          ]},
        ]
      }
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ erro: error.message });
  }
};
