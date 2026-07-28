Deno.serve(async (req) => {
  try {
    // Buscar conteúdo do GitHub via API (repo privado)
    const apiUrl = "https://api.github.com/repos/noc-arroba/Manutencao_De_Rede/contents/mapa_v2.html";
    const token = Deno.env.get("GITHUB_ACCESS_TOKEN") || "";
    const resp = await fetch(apiUrl, {
      headers: {
        "Authorization": "token " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "OTIA-Backend"
      }
    });
    
    if (!resp.ok) {
      return new Response("GitHub API error: " + resp.status, { status: 502 });
    }
    
    const data = await resp.json();
    // Decodificar base64
    const html = atob(data.content.replace(/\n/g, ""));
    
    // Trocar URLs relativas por absolutas (API do Vercel tem CORS *)
    const V = "https://manutencao-de-rede.vercel.app";
    let fixed = html.split("'/api/rede'").join("'" + V + "/api/rede'");
    fixed = fixed.split("'/rede_topologia.geojson'").join("'" + V + "/rede_topologia.geojson'");
    
    return new Response(fixed, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (err) {
    return new Response("Erro: " + String(err), { status: 500 });
  }
});
