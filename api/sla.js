// API: SLA Timeline — OS 303 (REDE FIBRA CAÍDA) e 304 (REDE CAIDA SOBRE AVISO)
// Fonte: IXC su_oss_chamado + radacct (hora real de queda e subida)
// Trilha: Queda → Abertura → Assumido → Cliente subiu

const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = Buffer.from('514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81').toString('base64');
const HEADERS = {
  'Authorization': `Basic ${IXC_TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'ixcsoft': 'listar'
};

const ASSUNTOS = { '303': 'NOC | REDE DE FIBRA CAÍDA', '304': 'NOC | REDE CAIDA SOBRE AVISO' };

function parseVlan(msg) {
  const m = msg.match(/CONEXÃO:\s*(.+?)(?:\n|$)/);
  if (!m) return { raw: '', vlans: [] };
  const raw = m[1].trim();
  const vlans = [...raw.matchAll(/(\d{3,4})/g)].map(m => m[1]).filter(v => v.length >= 3);
  return { raw, vlans };
}

function parseHoraQueda(msg) {
  const m = msg.match(/HORA DA QUEDA:\s*(\d+[:Hh]\d+)/);
  return m ? m[1].replace(/[Hh]/g, ':') : '';
}

function parseClientes(msg) {
  const m = msg.match(/CLIENTES ENVOLVIDOS:\s*(.+?)(?:\n|$)/);
  return m ? m[1].trim() : '';
}

function parseIxDate(s) {
  if (!s) return '';
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`;
  return s;
}

function calcDelta(start, end) {
  if (!start || !end || start.startsWith('0000') || end.startsWith('0000')) return null;
  try {
    const ds = new Date(start.replace(' ', 'T'));
    const de = new Date(end.replace(' ', 'T'));
    return (de - ds) / 60000;
  } catch { return null; }
}

async function buscarRadacct(login, abertura, horaQuedaEsperada) {
  try {
    const res = await fetch(`${IXC_URL}/radacct`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ qtype: 'username', query: login, oper: '=', page: '1', rp: '8', sortname: 'radacctid', sortorder: 'desc' })
    });
    const data = await res.json();
    const records = data.registros || [];
    const sessions = records.map(r => typeof r === 'string' ? JSON.parse(r) : r).map(r => ({
      start: parseIxDate(r.acctstarttime || ''),
      stop: parseIxDate(r.acctstoptime || '')
    }));

    let horaQueda = '', horaSubida = '';

    if (horaQuedaEsperada) {
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s.stop && !s.stop.startsWith('00')) {
          const stopDt = new Date(s.stop.replace(' ', 'T'));
          const diff = Math.abs(stopDt - horaQuedaEsperada) / 60000;
          const isManutencao = stopDt.getHours() === 4 && stopDt.getMinutes() < 10;
          if (diff < 10 && !isManutencao) {
            horaQueda = s.stop;
            if (i > 0) horaSubida = sessions[i - 1].start;
            break;
          }
        }
      }
    }

    if (!horaQueda && abertura) {
      const aberturaDt = new Date(abertura.replace(' ', 'T'));
      let bestDiff = 999999;
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        if (s.stop && !s.stop.startsWith('00')) {
          const stopDt = new Date(s.stop.replace(' ', 'T'));
          const isManutencao = stopDt.getHours() === 4 && stopDt.getMinutes() < 10;
          if (stopDt <= aberturaDt && !isManutencao) {
            const diff = (aberturaDt - stopDt) / 60000;
            if (diff < bestDiff && diff < 1440) {
              bestDiff = diff;
              horaQueda = s.stop;
              if (i > 0) horaSubida = sessions[i - 1].start;
            }
          }
        }
      }
    }

    return { horaQueda, horaSubida };
  } catch { return { horaQueda: '', horaSubida: '' }; }
}

async function fetchRadusuarios() {
  const allUsers = [];
  for (let page = 1; page <= 4; page++) {
    const res = await fetch(`${IXC_URL}/radusuarios`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ qtype: 'ativo', query: 'S', oper: '=', page: String(page), rp: '5000', sortname: 'id', sortorder: 'asc' })
    });
    const data = await res.json();
    const records = data.registros || [];
    if (!records.length) break;
    for (const r of records) {
      const rec = typeof r === 'string' ? JSON.parse(r) : r;
      allUsers.push(rec);
    }
    if (allUsers.length >= parseInt(data.total || 0)) break;
  }

  const vlanMap = {};
  for (const u of allUsers) {
    const conexao = String(u.conexao || '');
    const nums = [...conexao.matchAll(/(\d{3,4})/g)].map(m => m[1]);
    for (const n of nums) {
      if (!vlanMap[n]) vlanMap[n] = [];
      vlanMap[n].push(u.login || '');
    }
  }
  return vlanMap;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const periodo = req.query?.periodo || 'dia';
  const hoje = new Date();
  let dataInicio, dataFim;

  if (periodo === 'mes') {
    dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    dataFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);
  } else {
    dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);
    dataFim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);
  }

  try {
    const allOS = [];
    for (const [assuntoId, assuntoNome] of Object.entries(ASSUNTOS)) {
      const r = await fetch(`${IXC_URL}/su_oss_chamado`, {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({
          qtype: 'id_assunto', query: assuntoId, oper: '=',
          page: '1', rp: periodo === 'mes' ? '200' : '50',
          sortname: 'id', sortorder: 'desc'
        })
      });
      const data = await r.json();
      const records = data.registros || [];
      for (const rec of records) {
        const os = typeof rec === 'string' ? JSON.parse(rec) : rec;
        os._assunto_nome = assuntoNome;
        os._assunto_id = assuntoId;
        allOS.push(os);
      }
    }

    const osFiltradas = allOS.filter(os => {
      const abertura = os.data_abertura;
      if (!abertura || abertura.startsWith('0000')) return false;
      const dt = new Date(abertura.replace(' ', 'T'));
      return dt >= dataInicio && dt <= dataFim;
    });

    const vlanMap = await fetchRadusuarios();
    const resultados = [];

    for (const os of osFiltradas) {
      const msg = os.mensagem || '';
      const diagnostico = os.mensagem_resposta || '';
      const abertura = os.data_abertura || '';
      const assumido = os.data_hora_assumido || '';

      const { raw: vlanRaw, vlans } = parseVlan(msg);
      const horaQuedaMsg = parseHoraQueda(msg);
      const clientes = parseClientes(msg);

      let quedaEsperada = null;
      if (horaQuedaMsg && abertura) {
        try {
          const parts = horaQuedaMsg.split(':');
          const h = parseInt(parts[0]), mn = parseInt(parts[1]);
          const aberturaDt = new Date(abertura.replace(' ', 'T'));
          quedaEsperada = new Date(aberturaDt);
          quedaEsperada.setHours(h, mn, 0, 0);
          if (quedaEsperada > aberturaDt) {
            quedaEsperada.setDate(quedaEsperada.getDate() - 1);
          }
        } catch {}
      }

      let logins = [];
      for (const v of vlans) {
        if (vlanMap[v]) { logins = vlanMap[v].slice(0, 3); break; }
      }

      let horaQueda = '', horaSubida = '';
      for (const login of logins) {
        const result = await buscarRadacct(login, abertura, quedaEsperada);
        if (result.horaQueda) { horaQueda = result.horaQueda; horaSubida = result.horaSubida; break; }
      }

      if (!horaQueda && quedaEsperada) {
        horaQueda = quedaEsperada.toISOString().replace('T', ' ').substring(0, 19);
      }

      resultados.push({
        id: os.id, protocolo: os.protocolo || '', assunto: os._assunto_nome,
        vlan: vlans[0] || vlanRaw.substring(0, 20), clientes, diagnostico,
        horaQueda, abertura, assumido: assumido, horaSubida,
        tec: os.id_tecnico || '', status: os.status || '',
        slaQuedaAbertura: calcDelta(horaQueda, abertura),
        slaAberturaAssumido: calcDelta(abertura, assumido),
        slaAssumidoSubida: calcDelta(assumido, horaSubida),
        slaTotal: calcDelta(horaQueda, horaSubida)
      });
    }

    const validos = resultados.filter(r => r.slaTotal !== null && r.slaTotal > 0);
    const stats = {
      totalOS: resultados.length,
      totalClientes: resultados.reduce((s, r) => { const m = (r.clientes || '').match(/\d+/); return s + (m ? parseInt(m[0]) : 0); }, 0),
      osResolvidas: validos.length,
      mediaTotal: validos.length > 0 ? validos.reduce((s, r) => s + r.slaTotal, 0) / validos.length : 0,
      maxTotal: validos.length > 0 ? Math.max(...validos.map(r => r.slaTotal)) : 0,
      minTotal: validos.length > 0 ? Math.min(...validos.map(r => r.slaTotal)) : 0,
      slaEstourado: validos.filter(r => r.slaTotal > 120).length
    };

    res.status(200).json({ periodo, stats, resultados: resultados.sort((a, b) => b.abertura.localeCompare(a.abertura)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
