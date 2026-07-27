// API: Listar todas as OLTs do IXC com IP para cadastro SNMP
const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Buscar todas as OLTs
    const resp = await fetch(`${IXC_URL}/radtransmissor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${IXC_TOKEN}`,
        'ixcsoft': 'listar'
      },
      body: JSON.stringify({
        qtype: 'radtransmissor.id',
        oper: '>=',
        query: '0',
        rp: 100,
        sortname: 'radtransmissor.id',
        sortorder: 'asc'
      })
    });

    const data = await resp.json();
    const registros = data.registros || [];

    // Retornar todos os campos para descobrir qual tem o IP
    const olts = registros.map(r => {
      const fields = {};
      for (const [k, v] of Object.entries(r)) {
        fields[k] = v;
      }
      return fields;
    });

    res.json({ 
      total: olts.length,
      primeiro: olts[0] || null,
      olts: olts.map(o => ({
        id: o.id,
        descricao: o.descricao || o.nome || '',
        ip: o.ip || o.host || o.endereco_ip || o.ip_transmissor || o.ip_estacao || o.ip_olt || '',
        modelo: o.modelo || o.tipo || '',
        marca: o.marca || o.fabricante || '',
        todos_campos: Object.keys(o)
      }))
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};
