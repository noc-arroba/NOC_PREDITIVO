// API: Buscar IPs das OLTs no IXC
const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const headers = {
    'Authorization': `Basic ${IXC_TOKEN}`,
    'ixcsoft': 'listar',
    'Content-Type': 'application/json'
  };

  const resultados = {};

  // Tentar múltiplas tabelas possíveis
  const tabelas = ['radpop_radio_transmissor', 'transmissor', 'radtransmissor', 'ftth_transmissor'];
  
  for (const tabela of tabelas) {
    try {
      const resp = await fetch(`${IXC_URL}/${tabela}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          qtype: `${tabela}.id`,
          oper: '>=',
          query: '0',
          page: '1',
          rp: '50',
          sortname: `${tabela}.id`,
          sortorder: 'asc'
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        let registros = [];
        if (data.registros) {
          for (const reg of data.registros) {
            if (typeof reg === 'string') { try { registros.push(JSON.parse(reg)); } catch {} }
            else registros.push(reg);
          }
        }
        resultados[tabela] = {
          status: resp.status,
          total: data.total || registros.length,
          registros: registros.length,
          primeiro: registros[0] || null
        };
      } else {
        resultados[tabela] = { status: resp.status, erro: 'não encontrado' };
      }
    } catch (e) {
      resultados[tabela] = { erro: e.message };
    }
  }

  res.json({
    tabelas_testadas: Object.keys(resultados),
    resultados,
    timestamp: new Date().toISOString()
  });
};
