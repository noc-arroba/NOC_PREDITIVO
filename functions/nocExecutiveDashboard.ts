// NOC Preditivo — Dashboard Executivo
// Backend function que serve o dashboard hospedado no GitHub (repo público)
// As APIs de dados continuam no Vercel

const GITHUB_RAW = "https://raw.githubusercontent.com/noc-arroba/NOC_PREDITIVO/main/noc_preditivo/public/executive.html";

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  };

  try {
    // Buscar o HTML do GitHub raw
    const res = await fetch(GITHUB_RAW);
    
    if (res.ok) {
      let html = await res.text();
      
      // Substituir API_BASE para apontar pro Vercel
      html = html.replace(
        'const API_BASE = window.location.origin;',
        'const API_BASE = "https://noc-preditivo.vercel.app";'
      );
      
      // Corrigir links de navegação relativos para URLs absolutas do Vercel
      html = html.replace(/href="executive\.html"/g, 'href="#"');
      html = html.replace(/href="index\.html"/g, 'href="https://noc-preditivo.vercel.app/bgp-centro.html"');
      html = html.replace(/href="zabbix\.html"/g, 'href="https://noc-preditivo.vercel.app/zabbix.html"');
      html = html.replace(/href="flow\.html"/g, 'href="https://noc-preditivo.vercel.app/flow.html"');
      html = html.replace(/href="rb-cliente\.html"/g, 'href="https://noc-preditivo.vercel.app/rb-cliente.html"');
      html = html.replace(/href="security\.html"/g, 'href="https://noc-preditivo.vercel.app/security.html"');
      html = html.replace(/href="config\.html"/g, 'href="https://noc-preditivo.vercel.app/config.html"');
      
      return new Response(html, { headers });
    }
    
    // Fallback: HTML mínimo se GitHub falhar
    const fallback = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>NOC Preditivo</title></head>
<body style="background:#0a0e1a;color:#e0e0e0;font-family:sans-serif;padding:40px;text-align:center">
<h1>NOC Preditivo - Dashboard Executivo</h1>
<p style="color:#64748b;margin-top:20px">Carregando... Se persistir, acesse:</p>
<p style="margin-top:10px"><a href="https://noc-preditivo.vercel.app" style="color:#3b82f6">noc-preditivo.vercel.app</a></p>
<p style="color:#475569;font-size:12px;margin-top:20px">GitHub raw status: ${res.status}</p>
</body></html>`;
    
    return new Response(fallback, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
