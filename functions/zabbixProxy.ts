// =====================================================
// Zabbix API Proxy — NOC Preditivo
// Acesso somente leitura via Bearer Token
// =====================================================

const ZABBIX_URL = 'http://143.137.32.8:9090/zabbix/api_jsonrpc.php';
const ZABBIX_TOKEN = 'b43086606cc8e30738c7fea7b2e4ffc2c7cc6c27d81c11832a13c96940d2bc71';

const SEV_MAP = { 0: 'NA', 1: 'INFO', 2: 'WARN', 3: 'MED', 4: 'HIGH', 5: 'DISAS' };
const SEV_COLOR = { 0: '#64748b', 1: '#3b82f6', 2: '#fbbf24', 3: '#f97316', 4: '#ef4444', 5: '#dc2626' };

async function zabbixCall(method: string, params: any) {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const res = await fetch(ZABBIX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json-rpc',
      'Authorization': `Bearer ${ZABBIX_TOKEN}`
    },
    body,
  });
  const data: any = await res.json();
  if (data.error) throw new Error(data.error.data || data.error.message);
  return data.result;
}

export default async function(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.query.action || req.body?.action || 'overview';

    if (action === 'overview') {
      // Hosts ativos
      const hosts = await zabbixCall('host.get', {
        output: ['hostid', 'name', 'status'],
        selectInterfaces: ['ip', 'available', 'error'],
        filter: { status: 0 }
      });

      // Triggers ativos
      const triggers = await zabbixCall('trigger.get', {
        output: ['triggerid', 'description', 'priority', 'value', 'lastchange'],
        selectHosts: ['name', 'hostid'],
        filter: { value: 1 },
        sortfield: 'lastchange',
        sortorder: 'DESC',
        limit: 100
      });

      let hostsOk = 0, hostsDown = 0;
      for (const h of hosts) {
        const iface = h.interfaces?.[0];
        if (iface?.available === '1') hostsOk++;
        else if (iface?.available === '2') hostsDown++;
      }

      const bySev: any = {};
      const now = Date.now() / 1000;
      const triggersFormatted = triggers.map((t: any) => {
        const sev = parseInt(t.priority || 0);
        bySev[sev] = (bySev[sev] || 0) + 1;
        const ageSec = now - parseInt(t.lastchange || 0);
        let ageTxt;
        if (ageSec < 60) ageTxt = `${Math.floor(ageSec)}s`;
        else if (ageSec < 3600) ageTxt = `${Math.floor(ageSec/60)}min`;
        else if (ageSec < 86400) ageTxt = `${(ageSec/3600).toFixed(1)}h`;
        else ageTxt = `${(ageSec/86400).toFixed(1)}d`;

        return {
          triggerid: t.triggerid,
          host: t.hosts?.[0]?.name || 'N/A',
          hostid: t.hosts?.[0]?.hostid || null,
          description: t.description,
          severity: sev,
          severityName: SEV_MAP[sev as keyof typeof SEV_MAP] || '?',
          severityColor: SEV_COLOR[sev as keyof typeof SEV_COLOR] || '#64748b',
          lastchange: parseInt(t.lastchange || 0),
          ageTxt
        };
      });

      return res.json({
        timestamp: new Date().toISOString(),
        zabbixVersion: '7.0.19',
        stats: {
          totalHosts: hosts.length,
          hostsOk,
          hostsDown,
          totalTriggers: triggers.length,
          bySeverity: bySev
        },
        triggers: triggersFormatted
      });
    }

    if (action === 'hosts') {
      const hosts = await zabbixCall('host.get', {
        output: ['hostid', 'name', 'status'],
        selectInterfaces: ['ip', 'type', 'available', 'error'],
        selectGroups: ['name'],
        filter: { status: 0 }
      });
      return res.json({ hosts: hosts.map((h: any) => ({
        hostid: h.hostid,
        name: h.name,
        status: h.status,
        ip: h.interfaces?.[0]?.ip || '',
        available: h.interfaces?.[0]?.available || '0',
        error: h.interfaces?.[0]?.error || '',
        groups: h.groups?.map((g: any) => g.name) || []
      }))});
    }

    if (action === 'triggers') {
      const triggers = await zabbixCall('trigger.get', {
        output: ['triggerid', 'description', 'priority', 'value', 'lastchange', 'comments'],
        selectHosts: ['name', 'hostid'],
        filter: { value: 1 },
        sortfield: 'lastchange',
        sortorder: 'DESC',
        limit: 100
      });
      return res.json({ triggers });
    }

    return res.status(400).json({ error: 'Invalid action: ' + action });
  } catch (err: any) {
    console.error('Zabbix API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
