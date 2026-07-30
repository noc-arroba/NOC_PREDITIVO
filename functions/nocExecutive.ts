// NOC Preditivo — API Executiva (Base44)
// Agrega BGP + Zabbix do Vercel + RB Measurements da entity Base44
// Substitui o /api/executive.js que não deployou no Vercel

const BGP_API = 'https://noc-preditivo.vercel.app/api/bgp.js';
const ZABBIX_API = 'https://noc-preditivo.vercel.app/api/zabbix.js';

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'overview';

  try {
    if (action === 'overview') {
      // Buscar BGP e Zabbix em paralelo
      const [bgpRes, zabbixRes] = await Promise.allSettled([
        fetch(BGP_API).then(r => r.json()).catch(() => null),
        fetch(ZABBIX_API + '?action=overview').then(r => r.json()).catch(() => null),
      ]);

      const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;
      const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;

      // Calcular score
      let score = 100;
      const issues: string[] = [];

      if (bgp?.overview) {
        const totalPeers = bgp.overview.bgp_peers || 0;
        // Se tem peers, considera OK
      }
      
      if (bgp?.score_bgp !== undefined && bgp.score_bgp < 100) {
        score -= (100 - bgp.score_bgp) * 0.3;
        issues.push(`BGP score: ${bgp.score_bgp}/100`);
      }

      if (zabbix?.stats) {
        const downHosts = zabbix.stats.hostsDown || 0;
        if (downHosts > 0) {
          score -= downHosts * 5;
          issues.push(`${downHosts} equipamento(s) offline no Zabbix`);
        }
        
        const bySev = zabbix.stats.bySeverity || {};
        const critical = (bySev['5'] || 0) + (bySev['4'] || 0);
        if (critical > 0) {
          score -= Math.min(critical * 3, 30);
          issues.push(`${critical} alarme(s) de alta severidade`);
        }
      }

      score = Math.max(0, Math.round(score));

      // Top triggers (max 5)
      const topTriggers = (zabbix?.triggers || [])
        .filter((t: any) => t.severity >= 4)
        .slice(0, 5)
        .map((t: any) => ({
          host: t.host,
          description: t.description,
          severity: t.severity,
          severityName: t.severityName,
          age: t.ageTxt,
        }));

      return new Response(JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        score,
        status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
        sources: {
          bgp: bgp ? 'online' : 'offline',
          zabbix: zabbix ? 'online' : 'offline',
          flow: 'offline',
        },
        bgp: {
          asn: bgp?.overview?.asn || '264025',
          holder: bgp?.overview?.holder || 'Arroba Banda Larga',
          announcedPrefixes: bgp?.overview?.announced_prefixes || 0,
          bgpPeers: bgp?.overview?.bgp_peers || 0,
          score: bgp?.score_bgp || 100,
          stats: bgp?.stats || null,
        },
        zabbix: {
          totalHosts: zabbix?.stats?.totalHosts || 0,
          hostsOk: zabbix?.stats?.hostsOk || 0,
          hostsDown: zabbix?.stats?.hostsDown || 0,
          totalTriggers: zabbix?.stats?.totalTriggers || 0,
          bySeverity: zabbix?.stats?.bySeverity || {},
          topTriggers,
        },
        flow: null,
        issues,
      }), { headers });
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Unknown action: ' + action 
    }), { status: 400, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: e.message 
    }), { status: 500, headers });
  }
}
