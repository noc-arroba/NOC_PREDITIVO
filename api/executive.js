// ============ NOC PREDITIVO — EXECUTIVE DASHBOARD API ============
// Agrega dados de todas as fontes: BGP, Zabbix, Flow, RB Measurements
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BGP_API = 'https://noc-preditivo.vercel.app/api/bgp.js';
const ZABBIX_API = 'https://noc-preditivo.vercel.app/api/zabbix.js';
const FLOW_API = 'https://noc-preditivo.vercel.app/api/flow-proxy.js';

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'overview';
  
  try {
    if (action === 'overview') {
      // Buscar dados de todas as fontes em paralelo
      const [bgpRes, flowRes, zabbixRes] = await Promise.allSettled([
        fetch(BGP_API).then(r => r.json()).catch(() => null),
        fetch(FLOW_API + '?action=sources').then(r => r.json()).catch(() => null),
        fetch(ZABBIX_API + '?action=overview').then(r => r.json()).catch(() => null),
      ]);
      
      const bgp = bgpRes.status === 'fulfilled' ? bgpRes.value : null;
      const flow = flowRes.status === 'fulfilled' ? flowRes.value : null;
      const zabbix = zabbixRes.status === 'fulfilled' ? zabbixRes.value : null;
      
      // Calcular score da infraestrutura
      let score = 100;
      const issues = [];
      
      if (bgp?.data?.upstreams) {
        const downPeers = bgp.data.upstreams.filter((p: any) => p.status === 'down');
        if (downPeers.length > 0) {
          score -= downPeers.length * 15;
          issues.push(`${downPeers.length} peer(s) BGP down`);
        }
      }
      
      if (zabbix?.data?.triggers) {
        const criticalTriggers = zabbix.data.triggers.filter((t: any) => t.priority >= 4);
        if (criticalTriggers.length > 0) {
          score -= criticalTriggers.length * 10;
          issues.push(`${criticalTriggers.length} alarme(s) crítico(s) no Zabbix`);
        }
      }
      
      score = Math.max(0, score);
      
      return new Response(JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        score,
        status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
        sources: {
          bgp: bgp ? 'online' : 'offline',
          flow: flow ? 'online' : 'offline',
          zabbix: zabbix ? 'online' : 'offline',
        },
        bgp: bgp?.data || null,
        flow: flow?.data || null,
        zabbix: zabbix?.data || null,
        issues,
      }), { headers });
    }
    
    if (action === 'rb-latest') {
      // Buscar última medição da RB
      // Como não temos Supabase direto, retornamos null e o frontend busca da entity
      return new Response(JSON.stringify({
        success: true,
        message: 'Use GET /api/executive.js?action=rb-measurements para histórico',
      }), { headers });
    }
    
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers });
  }
}
