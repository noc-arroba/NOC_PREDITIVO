// API: Listar OLTs do IXC com IP para cadastro SNMP
const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const resp = await fetch(`${IXC_URL}/radtransmissor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${IXC_TOKEN}`,
        'ixcsoft': 'listar'
      },
      body: JSON.stringify({
        qtype: 'radtransmissor.id',
        oper: 'IN',
        query: '73,74,76,79,69,70,72',
        rp: 50,
        sortname: 'radtransmissor.id',
        sortorder: 'asc'
      })
    });

    const data = await resp.json();
    const registros = data.registros || [];

    const olts = registros.map(r => ({
      id: r.id,
      nome: r.descricao || r.nome || `OLT ${r.id}`,
      ip: r.ip || r.host || r.endereco_ip || r.ip_transmissor || '',
      modelo: r.modelo || r.tipo || '',
      marca: r.marca || r.fabricante || '',
      raw: r
    }));

    res.json({ olts, total: olts.length });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};
