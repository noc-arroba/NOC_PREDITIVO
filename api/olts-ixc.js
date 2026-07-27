// API: Listar OLTs do IXC com IP de gerência
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
    // Buscar 1 página de radtransmissor para debug
    const headers = {
      'Authorization': `Basic ${IXC_TOKEN}`,
      'ixcsoft': 'listar',
      'Content-Type': 'application/json'
    };

    // Tentar radtransmissor diretamente
    const resp = await fetch(`${IXC_URL}/radtransmissor`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        qtype: 'radtransmissor.id',
        oper: '>=',
        query: '0',
        page: '1',
        rp: '100',
        sortname: 'radtransmissor.id',
        sortorder: 'asc'
      })
    });

    const dataRaw = await resp.json();

    // Parsear registros
    let registros = [];
    if (dataRaw.registros) {
      for (const reg of dataRaw.registros) {
        if (typeof reg === 'string') { try { registros.push(JSON.parse(reg)); } catch {} }
        else registros.push(reg);
      }
    }

    if (registros.length > 0) {
      // Sucesso! Mostrar todos os campos da primeira OLT
      const primeiro = registros[0];
      const camposComIP = {};
      for (const [k, v] of Object.entries(primeiro)) {
        if (v && typeof v === 'string' && (k.toLowerCase().includes('ip') || k.toLowerCase().includes('host') || k.toLowerCase().includes('endere'))) {
          camposComIP[k] = v;
        }
      }

      const olts = registros.map(r => ({
        id: r.id,
        nome: r.descricao || r.nome || `OLT ${r.id}`,
        ip: r.ip || r.host || r.endereco_ip || r.ip_transmissor || r.ip_estacao || r.host_name || r.ip_olt || r.ip_gerencia || r.ip_gestao || '',
        modelo: r.modelo || r.tipo || '',
        marca: r.marca || r.fabricante || '',
        campos_ip: camposComIP
      }));

      return res.json({
        source: 'radtransmissor',
        total: registros.length,
        total_raw: dataRaw.total,
        primeiro_completo: primeiro,
        campos_ip_encontrados: camposComIP,
        olts
      });
    }

    // Fallback: extrair do radpop_radio_cliente_fibra usando ip_gerencia
    const fibra = await fetchIXC('radpop_radio_cliente_fibra', {
      qtype: 'radpop_radio_cliente_fibra.id',
      oper: '>=',
      query: '0',
      sortname: 'radpop_radio_cliente_fibra.id',
      sortorder: 'asc'
    }, 5000, 3);

    const oltMap = {};
    for (const f of fibra) {
      const oltId = f.id_transmissor;
      if (oltId && !oltMap[oltId]) {
        oltMap[oltId] = {
          id: oltId,
          nome: `OLT ${oltId}`,
          ip: f.ip_gerencia || '',
          modelo: '',
          marca: '',
          sample_onu_ip: f.ip_gerencia || ''
        };
      }
    }

    // Mostrar primeiro registro completo para debug
    const olts = Object.values(oltMap).sort((a, b) => a.id - b.id);

    res.json({
      source: 'radpop_radio_cliente_fibra',
      total: olts.length,
      primeiro_fibra: fibra[0] || null,
      olts
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
};
