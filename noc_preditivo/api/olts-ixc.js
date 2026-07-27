// API: Buscar OLTs do IXC e pré-cadastrar no NOC Preditivo
// O IXC não expõe radtransmissor via webservice, então usamos os dados
// do radpop_radio_cliente_fibra para extrair IDs e nomes das OLTs ativas.
// Os IPs devem ser preenchidos manualmente (consultar painel admin do IXC).

const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');

// OLTs FiberHome conhecidas da Arroba (IDs do IXC)
const OLTS_FIBERHOME = [
  { id: 73, nome: 'OLT-73 Santa Rosa 1', modelo: 'FiberHome AN5516-04', localizacao: 'POP Santa Rosa' },
  { id: 74, nome: 'OLT-74 Santa Rosa 2', modelo: 'FiberHome AN5516-04', localizacao: 'POP Santa Rosa' },
  { id: 76, nome: 'OLT-76 Santa Rosa 3', modelo: 'FiberHome AN5516-04', localizacao: 'POP Santa Rosa' },
  { id: 79, nome: 'OLT-79 Santa Rosa 4', modelo: 'FiberHome AN5516-04', localizacao: 'POP Santa Rosa' },
  { id: 69, nome: 'OLT-69 Santa Rosa 5', modelo: 'FiberHome AN5516-04', localizacao: 'POP Santa Rosa' },
  { id: 70, nome: 'OLT-70 Santa Rosa 6', modelo: 'FiberHome AN5516-04', localizacao: 'POP Santa Rosa' },
  { id: 72, nome: 'OLT-72 Santa Rosa 7', modelo: 'FiberHome AN5516-04', localizacao: 'POP Santa Rosa' },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Buscar dados do radpop_radio_cliente_fibra para confirmar OLTs ativas
    const headers = {
      'Authorization': `Basic ${IXC_TOKEN}`,
      'ixcsoft': 'listar',
      'Content-Type': 'application/json'
    };

    // Buscar 1 registro de cada OLT para confirmar que está ativa
    const oltsConfirmadas = [];

    for (const olt of OLTS_FIBERHOME) {
      try {
        const resp = await fetch(`${IXC_URL}/radpop_radio_cliente_fibra`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            qtype: 'radpop_radio_cliente_fibra.id_transmissor',
            oper: '=',
            query: String(olt.id),
            page: '1',
            rp: '1'
          })
        });

        const data = await resp.json();
        let registros = [];
        if (data.registros) {
          for (const reg of data.registros) {
            if (typeof reg === 'string') { try { registros.push(JSON.parse(reg)); } catch {} }
            else registros.push(reg);
          }
        }

        const ativa = registros.length > 0;
        oltsConfirmadas.push({
          ...olt,
          ativa,
          ip: '',  // IXC não expõe IP da OLT via webservice
          snmp_community: 'public',
          snmp_port: '161',
          snmp_version: 'v2c',
          oids: '1.3.6.1.2.1.1.3.0, 1.3.6.1.2.1.2.2.1.10, 1.3.6.1.2.1.2.2.1.16, 1.3.6.1.2.1.15, 1.3.6.1.4.1.5875',
          status: 'inactive',
          obs: 'IP não disponível no webservice IXC. Preencher manualmente (consultar painel admin).'
        });
      } catch (e) {
        oltsConfirmadas.push({
          ...olt,
          ativa: false,
          ip: '',
          erro: e.message
        });
      }
    }

    res.json({
      total: oltsConfirmadas.length,
      olts: oltsConfirmadas,
      note: 'IPs das OLTs não são expostos pelo webservice do IXC (radtransmissor não disponível). Preencher manualmente no painel de configuração.',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};
