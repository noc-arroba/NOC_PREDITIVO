// ============================================================
// NOC PREDITIVO — API: Teste de SNMP (simulado)
// No ambiente Vercel (serverless), não há acesso à rede interna
// Este endpoint valida a configuração e retorna instruções
// ============================================================

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { host, community, port } = req.query;

  if (!host) {
    return res.status(400).json({ erro: 'host é obrigatório' });
  }

  // No Vercel serverless, não há acesso à rede interna via SNMP
  // O teste real deve ser feito pelo coletor (VM no POP)
  res.json({
    host,
    community: community || 'public',
    port: port || 161,
    ok: false,
    message: 'Teste SNMP requer coletor ativo (VM no POP). Configure a VPN e inicie o agente coletor.',
    instructions: [
      '1. Configure a VPN nesta aba',
      '2. Instale o coletor SNMP na VM do POP (net-snmp ou node-snmp)',
      '3. O coletor faz polling dos dispositivos cadastrados',
      '4. Os dados são enviados para esta API e exibidos no dashboard'
    ],
    timestamp: new Date().toISOString()
  });
};
