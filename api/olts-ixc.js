// API: Buscar IPs das OLTs no IXC - tentar sem filtros
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

  // 1. Tentar radtransmissor sem filtros (só page + rp)
  try {
    const resp = await fetch(`${IXC_URL}/radtransmissor`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page: '1', rp: '50' })
    });
    const data = await resp.json();
    let registros = [];
    if (data.registros) {
      for (const reg of data.registros) {
        if (typeof reg === 'string') { try { registros.push(JSON.parse(reg)); } catch {} }
        else registros.push(reg);
      }
    }
    resultados.radtransmissor_sem_filtro = {
      status: resp.status,
      total: data.total || 0,
      registros: registros.length,
      primeiro: registros[0] || null,
      raw_response: JSON.stringify(data).substring(0, 500)
    };
  } catch (e) {
    resultados.radtransmissor_sem_filtro = { erro: e.message };
  }

  // 2. Tentar radtransmissor com qtype diferente
  try {
    const resp = await fetch(`${IXC_URL}/radtransmissor`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        qtype: 'id',
        oper: '>=',
        query: '1',
        page: '1',
        rp: '50'
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
    resultados.radtransmissor_qtype_simples = {
      total: data.total || 0,
      registros: registros.length,
      primeiro: registros[0] || null
    };
  } catch (e) {
    resultados.radtransmissor_qtype_simples = { erro: e.message };
  }

  // 3. Buscar nomes das OLTs do radpop_radio_cliente_fibra (já sabemos que funciona)
  // e pegar o nome do transmissor do registro
  try {
    const resp = await fetch(`${IXC_URL}/radpop_radio_cliente_fibra`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        qtype: 'radpop_radio_cliente_fibra.id_transmissor',
        oper: '=',
        query: '73',
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
    // Procurar campos com info do transmissor
    const r = registros[0] || {};
    const camposTransmissor = {};
    for (const [k, v] of Object.entries(r)) {
      if (k.toLowerCase().includes('transmissor') || k.toLowerCase().includes('olt')) {
        camposTransmissor[k] = v;
      }
    }
    resultados.fibra_olt73 = {
      campos_transmissor: camposTransmissor,
      nome: r.nome || '',
      id_transmissor: r.id_transmissor
    };
  } catch (e) {
    resultados.fibra_olt73 = { erro: e.message };
  }

  res.json({ resultados, timestamp: new Date().toISOString() });
};
