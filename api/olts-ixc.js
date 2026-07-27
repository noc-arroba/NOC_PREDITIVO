// API: Listar todas as OLTs do IXC com IP para cadastro SNMP
const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');

async function fetchIXC(tabela, body, rp = 100, maxPages = 5) {
  const headers = {
    'Authorization': `Basic ${IXC_TOKEN}`,
    'ixcsoft': 'listar',
    'Content-Type': 'application/json'
  };
  let allRecords = [];
  for (let page = 1; page <= maxPages; page++) {
    const payload = { ...body, page: String(page), rp: String(rp) };
    const resp = await fetch(`${IXC_URL}/${tabela}`, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!resp.ok) break;
    const data = await resp.json();
    if (!data.registros || data.registros.length === 0) break;
    for (const reg of data.registros) {
      if (typeof reg === 'string') { try { allRecords.push(JSON.parse(reg)); } catch {} }
      else allRecords.push(reg);
    }
    if (data.registros.length < rp) break;
  }
  return allRecords;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Buscar todas as OLTs da tabela radtransmissor
    const registros = await fetchIXC('radtransmissor', {
      qtype: 'radtransmissor.id',
      oper: '>=',
      query: '0',
      sortname: 'radtransmissor.id',
      sortorder: 'asc'
    }, 100, 3);

    // Se não encontrar na radtransmissor, tentar buscar via radpop_radio_cliente_fibra
    if (registros.length === 0) {
      // Buscar dados de clientes fibra e extrair OLTs
      const fibra = await fetchIXC('radpop_radio_cliente_fibra', {
        qtype: 'radpop_radio_cliente_fibra.id',
        oper: '>=',
        query: '0',
        sortname: 'radpop_radio_cliente_fibra.id',
        sortorder: 'asc'
      }, 10000, 3);

      // Extrair OLTs únicas
      const oltMap = {};
      for (const f of fibra) {
        const oltId = f.id_transmissor || f.transmissor_id || f.id_olt || f.olt_id;
        if (oltId && !oltMap[oltId]) {
          oltMap[oltId] = {
            id: oltId,
            nome: f.nome_transmissor || f.transmissor_nome || f.olt_nome || `OLT ${oltId}`,
            ip: f.ip_transmissor || f.transmissor_ip || f.olt_ip || '',
            modelo: f.modelo_transmissor || f.transmissor_modelo || '',
            marca: f.marca_transmissor || f.fabricante_transmissor || ''
          };
        }
      }

      const olts = Object.values(oltMap).sort((a, b) => a.id - b.id);
      return res.json({
        source: 'radpop_radio_cliente_fibra',
        total: olts.length,
        olts,
        raw_sample: fibra[0] ? Object.keys(fibra[0]).filter(k => 
          k.includes('olt') || k.includes('transmissor') || k.includes('ip') || k.includes('host')
        ) : []
      });
    }

    const olts = registros.map(r => ({
      id: r.id,
      nome: r.descricao || r.nome || `OLT ${r.id}`,
      ip: r.ip || r.host || r.endereco_ip || r.ip_transmissor || r.ip_estacao || r.host_name || r.ip_olt || '',
      modelo: r.modelo || r.tipo || '',
      marca: r.marca || r.fabricante || '',
      todos_campos: Object.keys(r)
    }));

    res.json({
      source: 'radtransmissor',
      total: olts.length,
      primeiro: registros[0] || null,
      olts
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
};
