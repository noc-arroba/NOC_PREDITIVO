import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============ RB MONITOR — NOC Preditivo ============
// Medição ativa via SSH na RB Cliente (TESTE-BANDA-WELLINHO)
// IP: 143.137.32.232:224 / user: otia

const RB_HOST = '143.137.32.232';
const RB_PORT = 224;
const RB_USER = 'otia';
const RB_PASS = 'Arr0b@2019Bl';

// Alvos de medição
const PING_TARGETS = [
  { name: 'Gateway-MX204-SR', ip: '143.137.32.4', role: 'gateway' },
  { name: 'Google-DNS', ip: '8.8.8.8', role: 'internet' },
  { name: 'Cloudflare-DNS', ip: '1.1.1.1', role: 'internet' },
  { name: 'CCR-Centro-1', ip: '143.137.32.7', role: 'core' },
  { name: 'CCR-Centro-2', ip: '143.137.32.8', role: 'core' },
  { name: 'IX-BR', ip: '187.16.222.6', role: 'ix' },
];

// Executar comando SSH na RB (via fetch para um proxy)
async function rbSSH(command: string): Promise<string> {
  // Este backend function atua como proxy SSH
  // Usa a conexão SSH via child_process (somente em runtime Node)
  const { execSync } = await import('child_process');
  
  const sshCmd = `sshpass -p '${RB_PASS}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o HostKeyAlgorithms='+ssh-rsa,ssh-dss' -o KexAlgorithms='diffie-hellman-group1-sha1' -o Ciphers='+aes128-ctr' -o MACs='+hmac-sha1' -p ${RB_PORT} ${RB_USER}@${RB_HOST} '${command.replace(/'/g, "'\\''")}'`;
  
  try {
    return execSync(sshCmd, { timeout: 30000, encoding: 'utf-8' });
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'status';
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
  
  try {
    if (action === 'ping') {
      // Ping para todos os alvos
      const results = [];
      for (const target of PING_TARGETS) {
        const output = await rbSSH(`/ping ${target.ip} count=10`);
        const parsed = parsePing(output);
        results.push({ ...target, ...parsed });
      }
      return new Response(JSON.stringify({ success: true, data: results, timestamp: new Date().toISOString() }), { headers });
    }
    
    if (action === 'traceroute') {
      const target = url.searchParams.get('target') || '8.8.8.8';
      const output = await rbSSH(`/tool traceroute ${target} count=1`);
      const hops = parseTraceroute(output);
      return new Response(JSON.stringify({ success: true, target, hops, timestamp: new Date().toISOString() }), { headers });
    }
    
    if (action === 'status') {
      // Status completo da RB
      const [identity, resource, interfaces, pppoe, routes] = await Promise.all([
        rbSSH('system identity print'),
        rbSSH('system resource print'),
        rbSSH('interface print'),
        rbSSH('interface pppoe-client print'),
        rbSSH('ip route print where dst-address=0.0.0.0/0'),
      ]);
      
      return new Response(JSON.stringify({
        success: true,
        data: { identity, resource, interfaces, pppoe, routes },
        timestamp: new Date().toISOString()
      }), { headers });
    }
    
    if (action === 'monitor') {
      // Monitor de tráfego das interfaces
      const iface = url.searchParams.get('iface') || 'otia';
      const output = await rbSSH(`/interface monitor-traffic ${iface} once`);
      return new Response(JSON.stringify({ success: true, iface, data: output, timestamp: new Date().toISOString() }), { headers });
    }
    
    return new Response(JSON.stringify({ error: 'Unknown action', actions: ['ping', 'traceroute', 'status', 'monitor'] }), { status: 400, headers });
    
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers });
  }
}

function parsePing(output: string) {
  const match = output.match(/sent=(\d+)\s+received=(\d+)\s+packet-loss=(\d+)%\s+min-rtt=(\d+)ms\s+avg-rtt=(\d+)ms\s+max-rtt=(\d+)ms/);
  if (match) {
    return {
      sent: parseInt(match[1]),
      received: parseInt(match[2]),
      packetLoss: parseInt(match[3]),
      minRtt: parseInt(match[4]),
      avgRtt: parseInt(match[5]),
      maxRtt: parseInt(match[6]),
    };
  }
  return { sent: 0, received: 0, packetLoss: 100, minRtt: 0, avgRtt: 0, maxRtt: 0 };
}

function parseTraceroute(output: string) {
  const hops = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)%\s+(\d+)\s+([\d.]+)ms\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (match) {
      hops.push({
        hop: parseInt(match[1]),
        address: match[2],
        loss: parseInt(match[3]),
        last: parseFloat(match[5]),
        avg: parseFloat(match[6]),
        best: parseFloat(match[7]),
        worst: parseFloat(match[8]),
      });
    }
  }
  return hops;
}
