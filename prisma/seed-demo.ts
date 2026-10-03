// Dados de demonstração: chamados espalhados no tempo para testar o dashboard e os filtros.
//
//   npm run seed:demo             # cria os chamados (recusa se já existirem)
//   npm run seed:demo -- --reset  # apaga os chamados de demonstração e recria
//   npm run seed:demo -- --se-vazio  # só cria se não houver nenhum chamado (usado no Docker)
//
// Os chamados de demonstração terminam a descrição com MARCADOR e o histórico segue as
// regras do sistema: criado como ABERTO, assumido por um atendente e, se concluído,
// concluído depois. Nada fica no futuro. Usa PRNG com semente fixa: sempre gera o mesmo.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, StatusSolicitacao } from '../src/generated/prisma/client.js';
import { deveSemear } from './demo-guarda.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const MARCADOR = '(dados de demonstração)';
const TOTAL = 150;
const DIAS_PARA_TRAS = 150;
const SOLICITANTES = ['solicitante.um', 'solicitante.dois'];
const ATENDENTES = ['atendente.um', 'atendente.dois'];

// Peso de cada setor (TI costuma concentrar mais chamados).
const CATEGORIAS: { nome: string; peso: number; assuntos: [string, string][] }[] = [
  {
    nome: 'TI',
    peso: 34,
    assuntos: [
      ['Notebook não liga', 'O notebook não dá sinal de vídeo ao pressionar o botão de ligar.'],
      ['Sem acesso ao sistema financeiro', 'Meu usuário retorna erro de permissão ao abrir o módulo.'],
      ['Mouse e teclado falhando', 'Os periféricos desconectam sozinhos durante o expediente.'],
      ['Internet lenta na sala 3', 'A conexão cai com frequência e as páginas demoram a carregar.'],
      ['Instalar planilhas avançadas', 'Preciso do pacote de planilhas para análise mensal.'],
      ['Impressora do 2º andar offline', 'A impressora aparece como indisponível na rede.'],
      ['Redefinir senha do e-mail', 'Esqueci a senha e o autoatendimento não envia o código.'],
      ['VPN não conecta em casa', 'O cliente de VPN trava na etapa de autenticação.'],
    ],
  },
  {
    nome: 'RH',
    peso: 16,
    assuntos: [
      ['Atualização de dados cadastrais', 'Preciso atualizar endereço e telefone no cadastro.'],
      ['Dúvida sobre banco de horas', 'O saldo exibido não confere com o meu controle.'],
      ['Solicitação de declaração de vínculo', 'Preciso de declaração para apresentar em instituição bancária.'],
      ['Alteração de dependentes no plano', 'Incluir um dependente no plano de saúde.'],
      ['Segunda via do holerite', 'Não localizo o holerite do mês passado no portal.'],
      ['Agendamento de férias', 'Quero programar o período de férias do próximo trimestre.'],
    ],
  },
  {
    nome: 'Compras',
    peso: 17,
    assuntos: [
      ['Compra de monitores adicionais', 'A equipe precisa de mais três monitores de 24 polegadas.'],
      ['Material de escritório', 'Reposição de papel, canetas e pastas para o setor.'],
      ['Cotação de cadeiras ergonômicas', 'Solicito três cotações para cadeiras do time de suporte.'],
      ['Licença de software de design', 'Aquisição de licenças anuais para a equipe de marketing.'],
      ['Renovação de contrato de limpeza', 'Verificar valores para renovação do contrato.'],
    ],
  },
  {
    nome: 'Financeiro',
    peso: 16,
    assuntos: [
      ['Reembolso de despesas de viagem', 'Envio das notas da viagem a cliente para reembolso.'],
      ['Nota fiscal com valor divergente', 'O valor da nota difere do pedido aprovado.'],
      ['Solicitação de adiantamento', 'Adiantamento para custos de evento externo.'],
      ['Comprovante de pagamento', 'Preciso do comprovante do pagamento do fornecedor.'],
      ['Conciliação do cartão corporativo', 'Há lançamentos que não reconheço na fatura.'],
    ],
  },
  {
    nome: 'Infraestrutura',
    peso: 17,
    assuntos: [
      ['Ar-condicionado com vazamento', 'O equipamento da sala de reuniões está pingando água.'],
      ['Lâmpadas queimadas no corredor', 'Várias lâmpadas do corredor principal não acendem.'],
      ['Porta da recepção travando', 'A porta emperra e não fecha totalmente.'],
      ['Falta de tomadas na sala 5', 'Não há tomadas suficientes para as novas estações.'],
      ['Infiltração no teto do arquivo', 'Há mancha de umidade crescente perto das prateleiras.'],
      ['Troca de fechadura do almoxarifado', 'A chave quebrou e precisa de nova fechadura.'],
    ],
  },
];

// PRNG determinístico (mulberry32): mesma semente, mesmos dados.
function criarAleatorio(semente: number) {
  let s = semente;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const aleatorio = criarAleatorio(20261005);
const entre = (min: number, max: number) => min + aleatorio() * (max - min);
const escolher = <T>(itens: T[]): T => itens[Math.floor(aleatorio() * itens.length)];

function escolherPonderado<T extends { peso: number }>(itens: T[]): T {
  let sorteio = aleatorio() * itens.reduce((acc, i) => acc + i.peso, 0);
  for (const item of itens) {
    sorteio -= item.peso;
    if (sorteio < 0) return item;
  }
  return itens[itens.length - 1];
}

const HORA = 3_600_000;

// Conversas dos chamados: gerador próprio, para não alterar os chamados já gerados com a semente acima.
const sorteioConversa = criarAleatorio(20261006);
const PERGUNTAS_DO_ATENDENTE = [
  'Olá! Pode me passar mais detalhes, por favor? Desde quando acontece?',
  'Recebi o chamado. Você consegue enviar o número do patrimônio ou o modelo do equipamento?',
  'Estou analisando. Isso ocorre sempre ou só em alguns horários?',
];
const RESPOSTAS_DO_SOLICITANTE = [
  'Começou ontem à tarde e acontece sempre que tento abrir.',
  'Claro, é o equipamento da minha mesa. Posso deixar disponível a qualquer hora.',
  'Só pela manhã, depois normaliza sozinho.',
];
const FECHAMENTOS_DO_ATENDENTE = [
  'Ajuste feito. Pode testar e me avisar se algo continuar estranho.',
  'Resolvido do nosso lado. Vou concluir o chamado.',
];
const COMPLEMENTOS_DO_SOLICITANTE = [
  'Só complementando: o problema também aparece no outro computador da sala.',
  'Se precisarem, estou disponível o dia todo.',
];
const sortearFrase = (frases: string[]) =>
  frases[Math.floor(sorteioConversa() * frases.length)];

// Chamados recentes tendem a estar abertos; os antigos, concluídos.
function sortearStatus(diasAtras: number): StatusSolicitacao {
  const [pConcluido, pAtendimento] =
    diasAtras > 14 ? [0.72, 0.2] : diasAtras > 3 ? [0.45, 0.3] : [0.15, 0.25];
  const sorteio = aleatorio();
  if (sorteio < pConcluido) return StatusSolicitacao.CONCLUIDO;
  if (sorteio < pConcluido + pAtendimento) return StatusSolicitacao.EM_ATENDIMENTO;
  return StatusSolicitacao.ABERTO;
}

// Dia útil, entre 8h e 18h no horário de Brasília (UTC-3).
function sortearDataCriacao(agora: Date): { data: Date; diasAtras: number } {
  const diasAtras = Math.floor(Math.pow(aleatorio(), 1.5) * DIAS_PARA_TRAS);
  const data = new Date(agora.getTime() - diasAtras * 24 * HORA);
  const diaDaSemana = data.getUTCDay();
  // Fim de semana vira sexta-feira na maior parte das vezes.
  if ((diaDaSemana === 0 || diaDaSemana === 6) && aleatorio() < 0.85) {
    data.setUTCDate(data.getUTCDate() - (diaDaSemana === 0 ? 2 : 1));
  }
  data.setUTCHours(11 + Math.floor(aleatorio() * 10), Math.floor(aleatorio() * 60), Math.floor(aleatorio() * 60), 0);
  // Nunca no futuro.
  if (data.getTime() > agora.getTime() - HORA) data.setTime(agora.getTime() - HORA * entre(1, 6));
  return { data, diasAtras };
}

async function main() {
  const reset = process.argv.includes('--reset');
  const seVazio = process.argv.includes('--se-vazio');
  if (seVazio) {
    const total = await prisma.solicitacao.count();
    if (!deveSemear(total, true)) {
      console.log(`Já existem ${total} chamados: seed de demonstração ignorado.`);
      return;
    }
  }
  const existentes = await prisma.solicitacao.count({
    where: { descricao: { contains: MARCADOR } },
  });
  if (existentes > 0 && !reset) {
    console.error(
      `Já existem ${existentes} chamados de demonstração. Use "npm run seed:demo -- --reset" para recriar.`,
    );
    process.exit(1);
  }
  if (reset) {
    // O histórico sai junto (ON DELETE CASCADE).
    const { count } = await prisma.solicitacao.deleteMany({
      where: { descricao: { contains: MARCADOR } },
    });
    console.log(`Apagados ${count} chamados de demonstração.`);
  }

  const usuarios = await prisma.usuario.findMany({
    where: { usuario: { in: [...SOLICITANTES, ...ATENDENTES] } },
  });
  const idDe = (login: string) => {
    const u = usuarios.find((x) => x.usuario === login);
    if (!u) throw new Error(`Usuário ${login} não existe. Rode "npx prisma db seed" antes.`);
    return u.id;
  };
  const solicitantes = SOLICITANTES.map(idDe);
  const atendentes = ATENDENTES.map(idDe);
  const categorias = await prisma.categoria.findMany({ where: { ativa: true } });
  const categoriaId = (nome: string) => {
    const c = categorias.find((x) => x.nome === nome);
    if (!c) throw new Error(`Categoria ${nome} não existe. Rode "npx prisma db seed" antes.`);
    return c.id;
  };

  const agora = new Date();
  // Ordena por data para os códigos crescerem junto com o tempo.
  const sorteados = Array.from({ length: TOTAL }, () => sortearDataCriacao(agora)).sort(
    (a, b) => a.data.getTime() - b.data.getTime(),
  );
  const resumo: Record<string, number> = { ABERTO: 0, EM_ATENDIMENTO: 0, CONCLUIDO: 0 };

  for (const { data: criacao, diasAtras } of sorteados) {
    const categoria = escolherPonderado(CATEGORIAS);
    const [titulo, texto] = escolher(categoria.assuntos);
    const solicitante = escolher(solicitantes);
    const status = sortearStatus(diasAtras);
    const limite = agora.getTime() - 60_000;

    const historico: {
      usuarioId: number;
      statusAnterior: StatusSolicitacao | null;
      statusNovo: StatusSolicitacao;
      dataAlteracao: Date;
    }[] = [
      { usuarioId: solicitante, statusAnterior: null, statusNovo: 'ABERTO', dataAlteracao: criacao },
    ];

    let responsavel: number | null = null;
    let assumidoEm = criacao.getTime();
    let fimEm = limite;

    if (status !== 'ABERTO') {
      const atendente = escolher(atendentes);
      const assumido = new Date(Math.min(criacao.getTime() + entre(0.5, 40) * HORA, limite));
      responsavel = atendente;
      assumidoEm = assumido.getTime();
      historico.push({
        usuarioId: atendente,
        statusAnterior: 'ABERTO',
        statusNovo: 'EM_ATENDIMENTO',
        dataAlteracao: assumido,
      });
      if (status === 'CONCLUIDO') {
        // Em geral quem assumiu conclui; às vezes outro atendente.
        const quemConclui = aleatorio() < 0.8 ? atendente : escolher(atendentes);
        const concluido = new Date(Math.min(assumido.getTime() + entre(1, 120) * HORA, limite));
        fimEm = concluido.getTime();
        historico.push({
          usuarioId: quemConclui,
          statusAnterior: 'EM_ATENDIMENTO',
          statusNovo: 'CONCLUIDO',
          dataAlteracao: concluido,
        });
      }
    }

    // Só atendente responsável e solicitante dono escrevem; nada depois da conclusão.
    const comentarios: { usuarioId: number; texto: string; dataCriacao: Date }[] = [];
    const comentar = (usuarioId: number, frase: string, ms: number) =>
      comentarios.push({ usuarioId, texto: frase, dataCriacao: new Date(ms) });
    if (responsavel !== null && sorteioConversa() < 0.55) {
      const janela = Math.max(fimEm - assumidoEm, 60_000);
      const t1 = Math.min(assumidoEm + janela * 0.1, fimEm);
      const t2 = Math.min(assumidoEm + janela * 0.4, fimEm);
      comentar(responsavel, sortearFrase(PERGUNTAS_DO_ATENDENTE), t1);
      comentar(solicitante, sortearFrase(RESPOSTAS_DO_SOLICITANTE), t2);
      if (status === 'CONCLUIDO') {
        comentar(responsavel, sortearFrase(FECHAMENTOS_DO_ATENDENTE), Math.min(assumidoEm + janela * 0.8, fimEm));
      }
    } else if (status === 'ABERTO' && sorteioConversa() < 0.15) {
      comentar(solicitante, sortearFrase(COMPLEMENTOS_DO_SOLICITANTE), Math.min(criacao.getTime() + entre(0.2, 3) * HORA, limite));
    }

    await prisma.solicitacao.create({
      data: {
        titulo,
        descricao: `${texto} ${MARCADOR}`,
        categoriaId: categoriaId(categoria.nome),
        usuarioId: solicitante,
        status,
        dataCriacao: criacao,
        historico: { create: historico },
        comentarios: { create: comentarios },
      },
    });
    resumo[status]++;
  }

  console.log(`Criados ${TOTAL} chamados de demonstração:`, resumo);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
