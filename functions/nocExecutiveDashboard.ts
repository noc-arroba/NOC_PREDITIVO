// NOC Preditivo — Dashboard Executivo (Base44)
// Serve o HTML + injeta a URL correta da API executiva do Base44

const GITHUB_RAW = "https://raw.githubusercontent.com/noc-arroba/NOC_PREDITIVO/main/noc_preditivo/public/executive.html";

// URL da API executiva no Base44
const EXEC_API = "https://6a617bdfd90040324b7d7251.base44.app/api/apps/6a617bdfd90040324b7d7251/functions/nocExecutive?action=overview";

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  };

  try {
    const res = await fetch(GITHUB_RAW);
    
    if (res.ok) {
      let html = await res.text();
      
      // Substituir API_BASE para apontar pro Base44 (API executiva)
      html = html.replace(
        /const API_BASE = window\.location\.origin;/,
        'const API_BASE = "https://6a617bdfd90040324b7d7251.base44.app/api/apps/6a617bdfd90040324b7d7251/functions";'
      );
      
      // Corrigir a chamada da API: trocar executive.js por nocExecutive
      html = html.replace(
        /\/api\/executive\.js\?action=overview/,
        '/nocExecutive?action=overview'
      );
      
      // Corrigir links de navegação
      html = html.replace(/href="executive\.html"/g, 'href="#"');
      html = html.replace(/href="index\.html"/g, 'href="https://noc-preditivo.vercel.app/bgp-centro.html"');
      html = html.replace(/href="zabbix\.html"/g, 'href="https://noc-preditivo.vercel.app/zabbix.html"');
      html = html.replace(/href="flow\.html"/g, 'href="https://noc-preditivo.vercel.app/flow.html"');
      html = html.replace(/href="rb-cliente\.html"/g, 'href="https://noc-preditivo.vercel.app/rb-cliente.html"');
      html = html.replace(/href="security\.html"/g, 'href="https://noc-preditivo.vercel.app/security.html"');
      html = html.replace(/href="config\.html"/g, 'href="https://noc-preditivo.vercel.app/config.html"');
      
      return new Response(html, { headers });
    }
    
    const fallback = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>NOC Preditivo</title></head>
<body style="background:#0a0e1a;color:#e0e0e0;font-family:sans-serif;padding:40px;text-align:center">
<h1>NOC Preditivo - Dashboard Executivo</h1>
<p style="color:#64748b;margin-top:20px">GitHub raw status: ${res.status}</p>
</body></html>`;
    
    return new Response(fallback, { headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
