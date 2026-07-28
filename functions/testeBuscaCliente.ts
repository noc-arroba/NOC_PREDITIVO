/**
 * OTIA — Teste de busca de cliente no IXC
 */
const IXC_URL = 'https://central.arrobabandalarga.com.br/webservice/v1';
const IXC_TOKEN = '514:d80878e07a48bd5b338b9c815cf914f8e9cc0a2c1becf36a7f7bf2d82e77da81';
const TOKEN_B64 = btoa(IXC_TOKEN);

const HEADERS: Record<string, string> = {
  'Authorization': `Basic ${TOKEN_B64}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'ixcsoft': 'listar'
};

async function ixcPost(endpoint: string, body: object): Promise<any> {
  const r = await fetch(`${IXC_URL}/${endpoint}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body)
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { error: 'parse_error', raw: text.slice(0, 500) }; }
}

Deno.serve(async (req: Request) => {
  const tentativas: any[] = [];

  // Tentativa 1: oper=LIKE sem %
  const t1 = await ixcPost('cliente', {
    qtype: 'cliente.nome', query: 'MORALES', oper: 'LIKE',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'LIKE sem %', result: t1.registros?.length || 0, sample: t1.registros?.[0]?.nome || t1.raw || 'none' });

  // Tentativa 2: query com % no início e fim
  const t2 = await ixcPost('cliente', {
    qtype: 'cliente.nome', query: '%MORALES%', oper: 'LIKE',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'LIKE com %%', result: t2.registros?.length || 0, sample: t2.registros?.[0]?.nome || 'none' });

  // Tentativa 3: query com % apenas no final
  const t3 = await ixcPost('cliente', {
    qtype: 'cliente.nome', query: '%MORALES', oper: 'LIKE',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'LIKE com % inicio', result: t3.registros?.length || 0, sample: t3.registros?.[0]?.nome || 'none' });

  // Tentativa 4: sem oper (default)
  const t4 = await ixcPost('cliente', {
    qtype: 'cliente.nome', query: 'MORALES',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'sem oper', result: t4.registros?.length || 0, sample: t4.registros?.[0]?.nome || t4.raw || 'none' });

  // Tentativa 5: buscar por LUIS
  const t5 = await ixcPost('cliente', {
    qtype: 'cliente.nome', query: 'LUIS', oper: 'LIKE',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'LIKE LUIS', result: t5.registros?.length || 0, sample: t5.registros?.[0]?.nome || 'none' });

  // Tentativa 6: buscar por GONZALEZ com LIKE
  const t6 = await ixcPost('cliente', {
    qtype: 'cliente.nome', query: 'GONZALEZ', oper: 'LIKE',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'LIKE GONZALEZ', result: t6.registros?.length || 0, sample: t6.registros?.[0]?.nome || 'none' });

  // Tentativa 7: busar por razao (pode ser PJ)
  const t7 = await ixcPost('cliente', {
    qtype: 'cliente.razao', query: 'LUIS', oper: 'LIKE',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'razao LIKE LUIS', result: t7.registros?.length || 0, sample: t7.registros?.[0]?.razao || t7.raw || 'none' });

  // Tentativa 8: buscar por cpf_cnpj
  // Tentar tambem por email
  const t8 = await ixcPost('cliente', {
    qtype: 'cliente.nome', query: 'LUIS EDUARDO', oper: 'LIKE',
    page: '1', rp: '5'
  });
  tentativas.push({ tentativa: 'LIKE LUIS EDUARDO', result: t8.registros?.length || 0, sample: t8.registros?.[0]?.nome || 'none' });

  return new Response(JSON.stringify({ success: true, tentativas }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
});
