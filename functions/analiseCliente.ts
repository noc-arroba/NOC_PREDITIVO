/**
 * OTIA — Análise de Cliente no IXC
 * Busca cliente por nome, OS abertas, histórico de OS e reclamações
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
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body)
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { registros: [], error: 'parse_error', raw: text.slice(0, 500) }; }
}

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json().catch(() => ({}));
    const nomeBusca = body.nome || 'LUIS EDUARDO GONZALEZ MORALES';

    // 1. Buscar cliente por nome
    const respCliente = await ixcPost('cliente', {
      qtype: 'cliente.nome', query: `%${nomeBusca}%`, oper: 'LIKE',
      page: '1', rp: '10',
      sortname: 'cliente.nome', sortorder: 'asc'
    });

    const clientes = respCliente.registros || [];
    if (!clientes.length) {
      // Tentar sem %
      const resp2 = await ixcPost('cliente', {
        qtype: 'cliente.nome', query: nomeBusca, oper: 'LIKE',
        page: '1', rp: '10'
      });
      const cli2 = resp2.registros || [];
      if (!cli2.length) {
        return new Response(JSON.stringify({ success: false, error: 'Cliente não encontrado', busca: nomeBusca }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      clientes.push(...cli2);
    }

    const resultados: any[] = [];

    for (const cli of clientes) {
      const clienteId = cli.id;

      // 2. Buscar OS do cliente (todas)
      const respOS = await ixcPost('su_oss_chamado', {
        qtype: 'su_oss_chamado.id_cliente', query: clienteId, oper: '=',
        page: '1', rp: '30',
        sortname: 'su_oss_chamado.data_abertura', sortorder: 'desc'
      });
      const todasOs = respOS.registros || [];
      const osAbertas = todasOs.filter((o: any) => o.status === 'A');
      const osFechadas = todasOs.filter((o: any) => o.status === 'F').slice(0, 15);

      // 3. Buscar tickets do cliente (com tratamento de erro)
      const respTickets = await ixcPost('su_ticket', {
        qtype: 'su_ticket.id_cliente', query: clienteId, oper: '=',
        page: '1', rp: '20',
        sortname: 'su_ticket.data_abertura', sortorder: 'desc'
      });
      const tickets = respTickets.registros || [];

      // 4. Buscar notificações / histórico de atendimento
      const respNotif = await ixcPost('su_oss_chamado_notificacao', {
        qtype: 'su_oss_chamado_notificacao.id_oss', query: clienteId, oper: 'LIKE',
        page: '1', rp: '20'
      });
      const notificacoes = respNotif.registros || [];

      resultados.push({
        cliente: {
          id: cli.id, nome: cli.nome, email: cli.email, telefone: cli.telefone,
          celular: cli.celular, endereco: cli.endereco, numero: cli.numero,
          bairro: cli.bairro, cidade: cli.cidade, status: cli.status,
          tipo: cli.tipo, data_cadastro: cli.data_cadastro
        },
        os_abertas: osAbertas.map((o: any) => ({
          id: o.id, data_abertura: o.data_abertura, setor: o.setor, status: o.status,
          descricao: o.descricao, id_tecnico: o.id_tecnico, data_prevista: o.data_prevista,
          prioridade: o.prioridade, processo: o.processo, diagnostico: o.diagnostico,
          data_fechamento: o.data_fechamento
        })),
        os_fechadas_recentes: osFechadas.map((o: any) => ({
          id: o.id, data_abertura: o.data_abertura, data_fechamento: o.data_fechamento,
          setor: o.setor, descricao: o.descricao, processo: o.processo,
          diagnostico: o.diagnostico, id_tecnico: o.id_tecnico
        })),
        tickets: tickets.map((t: any) => ({
          id: t.id, data_abertura: t.data_abertura, assunto: t.assunto,
          status: t.status, descricao: t.descricao
        })),
        total_os: todasOs.length,
        total_os_abertas: osAbertas.length,
        total_tickets: tickets.length
      });
    }

    return new Response(JSON.stringify({ success: true, resultados }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
