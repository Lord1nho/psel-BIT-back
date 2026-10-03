import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { configurarApp } from './../src/configurar-app.js';
import { hojeNoFuso, somarDias } from './../src/dashboard/periodo.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// Requer Postgres no ar com migrations e seed aplicados.
describe('Autenticação e solicitações (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    configurarApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CORS', () => {
    const preflight = (origem: string) =>
      request(app.getHttpServer())
        .options('/solicitacoes')
        .set('Origin', origem)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

    it('libera a origem do front no preflight', async () => {
      const res = await preflight('http://localhost:5173').expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
      expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
      expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
    });

    it('não libera outras origens', async () => {
      const res = await preflight('http://outro-site.com');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('GET /categorias', () => {
    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get('/categorias').expect(401);
    });

    it('lista as categorias ativas com id e nome, para qualquer perfil', async () => {
      for (const usuario of ['solicitante.um', 'atendente.um']) {
        const { body } = await login(usuario);
        const res = await request(app.getHttpServer())
          .get('/categorias')
          .set('Authorization', `Bearer ${body.accessToken}`)
          .expect(200);

        expect(res.body).toEqual(
          expect.arrayContaining([{ id: 1, nome: 'TI' }]),
        );
        for (const categoria of res.body) {
          expect(Object.keys(categoria).sort()).toEqual(['id', 'nome']);
        }
      }
    });

    it('não lista categoria inativa', async () => {
      const prisma = app.get(PrismaService);
      const { body } = await login('solicitante.um');
      await prisma.categoria.update({ where: { id: 5 }, data: { ativa: false } });
      try {
        const res = await request(app.getHttpServer())
          .get('/categorias')
          .set('Authorization', `Bearer ${body.accessToken}`)
          .expect(200);

        expect(res.body.map((c: { id: number }) => c.id)).not.toContain(5);
      } finally {
        await prisma.categoria.update({ where: { id: 5 }, data: { ativa: true } });
      }
    });
  });

  const login = (usuario: string, senha = '123456') =>
    request(app.getHttpServer()).post('/auth/login').send({ usuario, senha });

  it('login válido devolve token sem expor a senha', async () => {
    const res = await login('solicitante.um').expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.usuario).toMatchObject({
      usuario: 'solicitante.um',
      perfil: 'SOLICITANTE',
    });
    expect(res.body.usuario.senha).toBeUndefined();
  });

  it('login com senha errada retorna 401', async () => {
    await login('solicitante.um', 'errada').expect(401);
  });

  it('logout exige token e responde 204', async () => {
    await request(app.getHttpServer()).post('/auth/logout').expect(401);

    const { body } = await login('solicitante.um');
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(204);
  });

  it('POST /solicitacoes sem token retorna 401', async () => {
    await request(app.getHttpServer())
      .post('/solicitacoes')
      .send({ titulo: 'x', descricao: 'y', categoriaId: 1 })
      .expect(401);
  });

  it('cria solicitação ABERTO vinculada ao usuário do token', async () => {
    const { body: sessao } = await login('solicitante.um');

    const res = await request(app.getHttpServer())
      .post('/solicitacoes')
      .set('Authorization', `Bearer ${sessao.accessToken}`)
      .send({ titulo: 'Notebook lento', descricao: 'Trava no Excel', categoriaId: 1 })
      .expect(201);

    try {
      expect(res.body).toMatchObject({
        status: 'ABERTO',
        usuarioId: sessao.usuario.id,
      });
    } finally {
      // Não deixa o chamado de teste no banco (o histórico sai em cascata).
      await app
        .get(PrismaService)
        .solicitacao.delete({ where: { codigo: res.body.codigo } });
    }
  });

  it('rejeita campo extra e categoria inexistente com 400', async () => {
    const { body: sessao } = await login('solicitante.um');
    const auth = { Authorization: `Bearer ${sessao.accessToken}` };

    await request(app.getHttpServer())
      .post('/solicitacoes')
      .set(auth)
      .send({ titulo: 'x', descricao: 'y', categoriaId: 1, usuarioId: 99 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/solicitacoes')
      .set(auth)
      .send({ titulo: 'x', descricao: 'y', categoriaId: 999999 })
      .expect(400);
  });

  describe('perfil ATENDENTE', () => {
    it('não pode criar, editar nem excluir solicitações (403)', async () => {
      const { body: sessao } = await login('atendente.um');
      const auth = { Authorization: `Bearer ${sessao.accessToken}` };

      await request(app.getHttpServer())
        .post('/solicitacoes')
        .set(auth)
        .send({ titulo: 'x', descricao: 'y', categoriaId: 1 })
        .expect(403);
      await request(app.getHttpServer())
        .patch('/solicitacoes/1')
        .set(auth)
        .send({ titulo: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .delete('/solicitacoes/1')
        .set(auth)
        .expect(403);
    });
  });

  describe('editar e excluir (UC03/UC04)', () => {
    let auth: { Authorization: string };
    const criados: number[] = [];

    const criar = async () => {
      const res = await request(app.getHttpServer())
        .post('/solicitacoes')
        .set(auth)
        .send({ titulo: 'Original', descricao: 'Descrição', categoriaId: 1 })
        .expect(201);
      criados.push(res.body.codigo);
      return res.body.codigo as number;
    };

    beforeAll(async () => {
      const { body } = await login('solicitante.um');
      auth = { Authorization: `Bearer ${body.accessToken}` };
    });

    // Não deixa chamados de teste no banco (o histórico sai em cascata).
    afterAll(async () => {
      await app
        .get(PrismaService)
        .solicitacao.deleteMany({ where: { codigo: { in: criados } } });
    });

    it('edita solicitação ABERTO e mantém status e autor', async () => {
      const codigo = await criar();

      const res = await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigo}`)
        .set(auth)
        .send({ titulo: 'Editado', categoriaId: 2 })
        .expect(200);

      expect(res.body).toMatchObject({
        codigo,
        titulo: 'Editado',
        descricao: 'Descrição',
        categoriaId: 2,
        status: 'ABERTO',
      });
    });

    it('exclui solicitação ABERTO e remove o histórico em cascata', async () => {
      const codigo = await criar();
      const prisma = app.get(PrismaService);

      await request(app.getHttpServer())
        .delete(`/solicitacoes/${codigo}`)
        .set(auth)
        .expect(204);

      expect(await prisma.solicitacao.findUnique({ where: { codigo } })).toBeNull();
      expect(
        await prisma.historicoSolicitacao.count({
          where: { solicitacaoCodigo: codigo },
        }),
      ).toBe(0);
    });

    it('retorna 409 ao editar ou excluir solicitação fora de ABERTO', async () => {
      const codigo = await criar();
      // O atendente assume pela API (com histórico), em vez de mexer direto no banco.
      const { body: sessao } = await login('atendente.um');
      await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigo}/status`)
        .set({ Authorization: `Bearer ${sessao.accessToken}` })
        .send({ status: 'EM_ATENDIMENTO' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigo}`)
        .set(auth)
        .send({ titulo: 'Tentativa' })
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/solicitacoes/${codigo}`)
        .set(auth)
        .expect(409);
    });

    it('retorna 404 para código inexistente e 400 para código inválido', async () => {
      await request(app.getHttpServer())
        .patch('/solicitacoes/999999')
        .set(auth)
        .send({ titulo: 'x' })
        .expect(404);
      await request(app.getHttpServer())
        .delete('/solicitacoes/999999')
        .set(auth)
        .expect(404);
      await request(app.getHttpServer())
        .patch('/solicitacoes/abc')
        .set(auth)
        .send({ titulo: 'x' })
        .expect(400);
    });

    it('rejeita corpo vazio, campo proibido e categoria inexistente (400)', async () => {
      const codigo = await criar();

      await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigo}`)
        .set(auth)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigo}`)
        .set(auth)
        .send({ status: 'CONCLUIDO' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigo}`)
        .set(auth)
        .send({ categoriaId: 999999 })
        .expect(400);
    });

    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer())
        .patch('/solicitacoes/1')
        .send({ titulo: 'x' })
        .expect(401);
      await request(app.getHttpServer()).delete('/solicitacoes/1').expect(401);
    });
  });

  describe('listar, consultar e alterar status (UC05/UC06)', () => {
    const marcador = `E2E${Date.now()}`;
    let solicitante: { Authorization: string };
    let atendente: { Authorization: string };
    let idSolicitante: number;
    let codigoProprio: number;
    let codigoAlheio: number;

    // Sem "tamanho" explícito pede 100 por página, para o teste não depender dos 20 do padrão.
    const listar = (auth: { Authorization: string }, query = '') => {
      const comTamanho = /(^|[?&])tamanho=/.test(query)
        ? query
        : `${query ? `${query}&` : '?'}tamanho=100`;
      return request(app.getHttpServer()).get(`/solicitacoes${comTamanho}`).set(auth);
    };
    const codigos = (itens: { codigo: number }[]) => itens.map((s) => s.codigo);

    beforeAll(async () => {
      const prisma = app.get(PrismaService);
      const { body: s } = await login('solicitante.um');
      const { body: a } = await login('atendente.um');
      solicitante = { Authorization: `Bearer ${s.accessToken}` };
      atendente = { Authorization: `Bearer ${a.accessToken}` };
      idSolicitante = s.usuario.id;

      const res = await request(app.getHttpServer())
        .post('/solicitacoes')
        .set(solicitante)
        .send({ titulo: `Notebook ${marcador}`, descricao: 'Detalhe', categoriaId: 1 })
        .expect(201);
      codigoProprio = res.body.codigo;

      // Solicitação "de outro usuário": o seed só tem um solicitante.
      const alheio = await prisma.solicitacao.create({
        data: {
          titulo: `Alheio ${marcador}`,
          descricao: 'Outro dono',
          categoriaId: 2,
          usuarioId: a.usuario.id,
        },
      });
      codigoAlheio = alheio.codigo;
    });

    afterAll(async () => {
      await app
        .get(PrismaService)
        .solicitacao.deleteMany({ where: { titulo: { contains: marcador } } });
    });

    it('solicitante lista só as próprias, com solicitante e categoria', async () => {
      const res = await listar(solicitante).expect(200);

      expect(codigos(res.body.itens)).toContain(codigoProprio);
      expect(codigos(res.body.itens)).not.toContain(codigoAlheio);
      for (const item of res.body.itens) {
        expect(item.solicitante.id).toBe(idSolicitante);
        expect(item.categoria).toEqual({ id: expect.any(Number), nome: expect.any(String) });
        expect(item.usuario).toBeUndefined();
      }
    });

    it('atendente lista todas', async () => {
      const res = await listar(atendente).expect(200);

      expect(codigos(res.body.itens)).toEqual(
        expect.arrayContaining([codigoProprio, codigoAlheio]),
      );
    });

    it('busca livre acha por parte do título, por solicitante e por código', async () => {
      const parteTitulo = await listar(atendente, `?q=notebook ${marcador.slice(0, 8)}`).expect(200);
      expect(codigos(parteTitulo.body.itens)).toContain(codigoProprio);
      expect(codigos(parteTitulo.body.itens)).not.toContain(codigoAlheio);

      const porSolicitante = await listar(atendente, '?q=solicitante um').expect(200);
      expect(codigos(porSolicitante.body.itens)).toContain(codigoProprio);
      expect(codigos(porSolicitante.body.itens)).not.toContain(codigoAlheio);

      const porCodigo = await listar(atendente, `?q=${codigoAlheio}`).expect(200);
      expect(codigos(porCodigo.body.itens)).toContain(codigoAlheio);
    });

    it('busca livre do solicitante nunca sai do próprio escopo', async () => {
      const res = await listar(solicitante, `?q=${marcador}`).expect(200);

      expect(codigos(res.body.itens)).toEqual([codigoProprio]);
    });

    it('filtra por status, categoria e período', async () => {
      const status = await listar(atendente, `?status=CONCLUIDO&q=${marcador}`).expect(200);
      expect(status.body.itens).toEqual([]);

      const categoria = await listar(atendente, `?categoriaId=2&q=${marcador}`).expect(200);
      expect(codigos(categoria.body.itens)).toEqual([codigoAlheio]);

      const hoje = new Date().toISOString().slice(0, 10);
      const noPeriodo = await listar(atendente, `?dataInicio=${hoje}&dataFim=${hoje}&q=${marcador}`).expect(200);
      expect(codigos(noPeriodo.body.itens)).toEqual(
        expect.arrayContaining([codigoProprio, codigoAlheio]),
      );

      const futuro = await listar(atendente, `?dataInicio=2999-01-01&q=${marcador}`).expect(200);
      expect(futuro.body.itens).toEqual([]);
      const passado = await listar(atendente, `?dataFim=2000-01-01&q=${marcador}`).expect(200);
      expect(passado.body.itens).toEqual([]);
    });

    it('rejeita filtros inválidos com 400', async () => {
      await listar(atendente, '?status=XYZ').expect(400);
      await listar(atendente, '?categoriaId=abc').expect(400);
      await listar(atendente, '?dataInicio=01/09/2026').expect(400);
      await listar(atendente, '?dataInicio=2026-09-30&dataFim=2026-09-01').expect(400);
      await listar(atendente, '?usuarioId=1').expect(400);
    });

    describe('paginação, vários status e cache da listagem', () => {
      const QTD_EXTRA = 5;
      const statusExtras = ['ABERTO', 'ABERTO', 'EM_ATENDIMENTO', 'CONCLUIDO', 'CONCLUIDO'] as const;

      const contarNoBanco = (where: object) =>
        app.get(PrismaService).solicitacao.count({
          where: { titulo: { contains: marcador }, ...where },
        });

      // Atendente descartável que "assume" os chamados desta seção, para o histórico ficar
      // coerente (todo EM_ATENDIMENTO/CONCLUIDO tem quem assumiu) sem mexer nos atendentes reais.
      const ATENDENTE_PAGINACAO = 'atendente.e2e.paginacao';

      beforeAll(async () => {
        // Mais chamados do mesmo solicitante, com datas diferentes, para paginar.
        const prisma = app.get(PrismaService);
        const extra = await prisma.usuario.upsert({
          where: { usuario: ATENDENTE_PAGINACAO },
          update: {},
          create: {
            nome: 'Atendente E2E Paginação',
            usuario: ATENDENTE_PAGINACAO,
            senha: 'sem-login', // nunca faz login: não é um hash válido
            perfil: 'ATENDENTE',
          },
        });
        const agora = Date.now();
        for (let i = 0; i < QTD_EXTRA; i++) {
          const status = statusExtras[i];
          const criacao = new Date(agora - (i + 1) * 60_000);
          const depois = (segundos: number) => new Date(criacao.getTime() + segundos * 1000);
          await prisma.solicitacao.create({
            data: {
              titulo: `Paginacao ${marcador} ${i + 1}`,
              descricao: 'Chamado para testar a paginação',
              categoriaId: 3,
              usuarioId: idSolicitante,
              status,
              dataCriacao: criacao,
              historico: {
                create: [
                  { usuarioId: idSolicitante, statusAnterior: null, statusNovo: 'ABERTO', dataAlteracao: criacao },
                  ...(status !== 'ABERTO'
                    ? [{ usuarioId: extra.id, statusAnterior: 'ABERTO' as const, statusNovo: 'EM_ATENDIMENTO' as const, dataAlteracao: depois(1) }]
                    : []),
                  ...(status === 'CONCLUIDO'
                    ? [{ usuarioId: extra.id, statusAnterior: 'EM_ATENDIMENTO' as const, statusNovo: 'CONCLUIDO' as const, dataAlteracao: depois(2) }]
                    : []),
                ],
              },
            },
          });
        }
      });

      afterAll(async () => {
        // Primeiro os chamados (o histórico sai junto): o histórico referencia o atendente.
        const prisma = app.get(PrismaService);
        await prisma.solicitacao.deleteMany({
          where: { titulo: { startsWith: `Paginacao ${marcador}` } },
        });
        await prisma.usuario.deleteMany({ where: { usuario: ATENDENTE_PAGINACAO } });
      });

      it('pagina sem repetir nem pular chamados, com total e totalPaginas', async () => {
        const total = await contarNoBanco({});
        const tamanho = 3;
        const totalPaginas = Math.ceil(total / tamanho);
        const vistos: number[] = [];

        for (let pagina = 1; pagina <= totalPaginas; pagina++) {
          const res = await listar(atendente, `?q=${marcador}&pagina=${pagina}&tamanho=${tamanho}`).expect(200);

          expect(res.body).toMatchObject({ total, pagina, tamanho, totalPaginas });
          expect(res.body.itens.length).toBe(
            pagina < totalPaginas ? tamanho : total - tamanho * (totalPaginas - 1),
          );
          vistos.push(...codigos(res.body.itens));
        }

        expect(vistos).toHaveLength(total);
        expect(new Set(vistos).size).toBe(total);
        expect(total).toBeGreaterThanOrEqual(QTD_EXTRA + 2);
      });

      it('mantém a ordem da mais recente para a mais antiga entre as páginas', async () => {
        const res = await listar(atendente, `?q=${marcador}&tamanho=100`).expect(200);
        const datas = res.body.itens.map((s: { dataCriacao: string }) => s.dataCriacao);

        expect(datas).toEqual([...datas].sort().reverse());
      });

      it('página além do fim devolve lista vazia, mantendo total e totalPaginas', async () => {
        const total = await contarNoBanco({});
        const res = await listar(atendente, `?q=${marcador}&pagina=50&tamanho=3`).expect(200);

        expect(res.body.itens).toEqual([]);
        expect(res.body).toMatchObject({
          total,
          pagina: 50,
          tamanho: 3,
          totalPaginas: Math.ceil(total / 3),
        });
      });

      it('sem pagina e tamanho usa a página 1 com 20 itens', async () => {
        const res = await request(app.getHttpServer())
          .get('/solicitacoes')
          .set(atendente)
          .expect(200);

        expect(res.body).toMatchObject({ pagina: 1, tamanho: 20 });
        expect(res.body.itens).toHaveLength(20);
      });

      it('sem resultados: itens vazio, total 0 e totalPaginas 0', async () => {
        const res = await listar(atendente, '?q=nao-existe-nenhum-chamado-assim-xyz').expect(200);

        expect(res.body).toMatchObject({ itens: [], total: 0, totalPaginas: 0 });
      });

      it('o total respeita o escopo de cada perfil e bate com o banco', async () => {
        const prisma = app.get(PrismaService);
        const geral = await listar(atendente, '?tamanho=1').expect(200);
        const proprio = await listar(solicitante, '?tamanho=1').expect(200);

        expect(geral.body.total).toBe(await prisma.solicitacao.count());
        expect(proprio.body.total).toBe(
          await prisma.solicitacao.count({ where: { usuarioId: idSolicitante } }),
        );
        expect(proprio.body.total).toBeLessThan(geral.body.total);
      });

      it('vários status: vírgula e parâmetro repetido dão o mesmo resultado', async () => {
        const esperado = await contarNoBanco({ status: { in: ['ABERTO', 'EM_ATENDIMENTO'] } });
        const virgula = await listar(atendente, `?q=${marcador}&status=ABERTO,EM_ATENDIMENTO`).expect(200);
        const repetido = await listar(atendente, `?q=${marcador}&status=ABERTO&status=EM_ATENDIMENTO`).expect(200);

        expect(virgula.body.total).toBe(esperado);
        expect(codigos(repetido.body.itens)).toEqual(codigos(virgula.body.itens));
        for (const item of virgula.body.itens) {
          expect(['ABERTO', 'EM_ATENDIMENTO']).toContain(item.status);
        }
      });

      it('os filtros de status particionam o resultado (nada some, nada repete)', async () => {
        const total = await contarNoBanco({});
        const abertoEAtendimento = await listar(atendente, `?q=${marcador}&status=ABERTO,EM_ATENDIMENTO`).expect(200);
        const concluidos = await listar(atendente, `?q=${marcador}&status=CONCLUIDO`).expect(200);

        expect(abertoEAtendimento.body.total + concluidos.body.total).toBe(total);
        for (const item of concluidos.body.itens) expect(item.status).toBe('CONCLUIDO');
      });

      it('um status só continua funcionando como antes', async () => {
        const esperado = await contarNoBanco({ status: 'CONCLUIDO' });
        const res = await listar(atendente, `?q=${marcador}&status=CONCLUIDO`).expect(200);

        expect(res.body.total).toBe(esperado);
        expect(esperado).toBeGreaterThanOrEqual(2);
      });

      it('status ausente, vazio ou repetido não filtra ou ignora duplicados', async () => {
        const total = await contarNoBanco({});
        const semStatus = await listar(atendente, `?q=${marcador}`).expect(200);
        const vazio = await listar(atendente, `?q=${marcador}&status=`).expect(200);
        const dobrado = await listar(atendente, `?q=${marcador}&status=ABERTO,ABERTO`).expect(200);

        expect(semStatus.body.total).toBe(total);
        expect(vazio.body.total).toBe(total);
        expect(dobrado.body.total).toBe(await contarNoBanco({ status: 'ABERTO' }));
      });

      it('vários status combinam com setor e escopo do solicitante', async () => {
        const esperado = await contarNoBanco({
          usuarioId: idSolicitante,
          categoriaId: 3,
          status: { in: ['ABERTO', 'EM_ATENDIMENTO'] },
        });
        const res = await listar(solicitante, `?q=${marcador}&categoriaId=3&status=ABERTO,EM_ATENDIMENTO`).expect(200);

        expect(res.body.total).toBe(esperado);
        for (const item of res.body.itens) {
          expect(item.categoria.id).toBe(3);
          expect(item.solicitante.id).toBe(idSolicitante);
        }
      });

    describe('filtro por atendente (roda no servidor, antes e depois da paginação)', () => {
      let atendente2: { Authorization: string };
      let idAtendente1: number;
      let idAtendente2: number;
      const assumidosPor1: number[] = [];
      const assumidosPor2: number[] = [];

      const criarEAssumir = async (quem: { Authorization: string }, titulo: string, categoriaId: number) => {
        const res = await request(app.getHttpServer())
          .post('/solicitacoes')
          .set(solicitante)
          .send({ titulo: `${titulo} ${marcador}`, descricao: 'x', categoriaId })
          .expect(201);
        await request(app.getHttpServer())
          .patch(`/solicitacoes/${res.body.codigo}/status`)
          .set(quem)
          .send({ status: 'EM_ATENDIMENTO' })
          .expect(200);
        return res.body.codigo as number;
      };

      beforeAll(async () => {
        const { body: a1 } = await login('atendente.um');
        const { body: a2 } = await login('atendente.dois');
        atendente2 = { Authorization: `Bearer ${a2.accessToken}` };
        idAtendente1 = a1.usuario.id;
        idAtendente2 = a2.usuario.id;

        // atendente.um assume 3 chamados (um deles é concluído depois); atendente.dois assume 2.
        assumidosPor1.push(await criarEAssumir(atendente, 'Assumido A', 1));
        assumidosPor1.push(await criarEAssumir(atendente, 'Assumido B', 2));
        assumidosPor1.push(await criarEAssumir(atendente, 'Assumido C', 1));
        await request(app.getHttpServer())
          .patch(`/solicitacoes/${assumidosPor1[2]}/status`)
          .set(atendente)
          .send({ status: 'CONCLUIDO' })
          .expect(200);
        assumidosPor2.push(await criarEAssumir(atendente2, 'Assumido D', 1));
        assumidosPor2.push(await criarEAssumir(atendente2, 'Assumido E', 3));
      });

      it('devolve só os chamados que aquele atendente assumiu, e o total bate com o banco', async () => {
        const esperado = await app.get(PrismaService).solicitacao.count({
          where: {
            titulo: { contains: marcador },
            historico: { some: { statusNovo: 'EM_ATENDIMENTO', usuarioId: idAtendente1 } },
          },
        });
        const res = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}`).expect(200);

        expect(res.body.total).toBe(esperado);
        expect(codigos(res.body.itens).sort()).toEqual(
          expect.arrayContaining([...assumidosPor1].sort()),
        );
        for (const item of res.body.itens) {
          expect(item.atendente).toEqual({ id: idAtendente1, nome: 'Atendente Um' });
        }
        for (const codigo of assumidosPor2) {
          expect(codigos(res.body.itens)).not.toContain(codigo);
        }
      });

      it('cada atendente enxerga só os seus (os conjuntos não se misturam)', async () => {
        const um = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}`).expect(200);
        const dois = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente2}`).expect(200);

        expect(codigos(dois.body.itens).sort()).toEqual([...assumidosPor2].sort());
        const emComum = codigos(um.body.itens).filter((c: number) => codigos(dois.body.itens).includes(c));
        expect(emComum).toEqual([]);
        for (const item of dois.body.itens) {
          expect(item.atendente).toEqual({ id: idAtendente2, nome: 'Atendente Dois' });
        }
      });

      it('o filtro vale em todas as páginas, não só na atual', async () => {
        const vistos: number[] = [];
        const primeira = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}&tamanho=1&pagina=1`).expect(200);
        const totalPaginas = primeira.body.totalPaginas;

        expect(totalPaginas).toBe(primeira.body.total); // 1 item por página
        for (let pagina = 1; pagina <= totalPaginas; pagina++) {
          const res = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}&tamanho=1&pagina=${pagina}`).expect(200);
          expect(res.body.itens).toHaveLength(1);
          expect(res.body.itens[0].atendente.id).toBe(idAtendente1);
          vistos.push(res.body.itens[0].codigo);
        }
        expect(new Set(vistos).size).toBe(totalPaginas);
        expect(vistos).toEqual(expect.arrayContaining(assumidosPor1));
      });

      it('combina com status, setor e escopo do solicitante', async () => {
        const concluidos = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}&status=CONCLUIDO`).expect(200);
        expect(codigos(concluidos.body.itens)).toEqual([assumidosPor1[2]]);

        const emAtendimento = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}&status=EM_ATENDIMENTO`).expect(200);
        expect(codigos(emAtendimento.body.itens).sort()).toEqual([assumidosPor1[0], assumidosPor1[1]].sort());

        const setor = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}&categoriaId=2`).expect(200);
        expect(codigos(setor.body.itens)).toEqual([assumidosPor1[1]]);

        // O solicitante também pode filtrar os próprios chamados por atendente.
        const proprio = await listar(solicitante, `?q=${marcador}&atendenteId=${idAtendente2}`).expect(200);
        expect(codigos(proprio.body.itens).sort()).toEqual([...assumidosPor2].sort());
      });

      it('atendente sem chamados devolve lista vazia, e chamado nunca assumido não aparece', async () => {
        const inexistente = await listar(atendente, '?atendenteId=999999').expect(200);
        expect(inexistente.body).toMatchObject({ itens: [], total: 0, totalPaginas: 0 });

        // O chamado "Alheio" dos testes anteriores nunca foi assumido por ninguém.
        const res = await listar(atendente, `?q=${marcador}&atendenteId=${idAtendente1}`).expect(200);
        for (const item of res.body.itens) expect(item.titulo).not.toMatch(/^Alheio/);
      });

      it('rejeita atendenteId inválido com 400', async () => {
        for (const valor of ['0', '-1', 'abc', '1.5']) {
          await listar(atendente, `?atendenteId=${valor}`).expect(400);
        }
      });
    });

      it('rejeita paginação e status inválidos com 400', async () => {
        for (const query of [
          '?pagina=0',
          '?pagina=-1',
          '?pagina=abc',
          '?pagina=1.5',
          '?tamanho=0',
          '?tamanho=101',
          '?tamanho=abc',
          '?status=ABERTO,XYZ',
          '?offset=10',
        ]) {
          await listar(atendente, query).expect(400);
        }
      });

      it('aceita os limites de tamanho: 1 e 100', async () => {
        const um = await listar(atendente, '?tamanho=1').expect(200);
        const cem = await listar(atendente, '?tamanho=100').expect(200);

        expect(um.body.itens).toHaveLength(1);
        expect(cem.body.itens.length).toBeLessThanOrEqual(100);
        expect(cem.body.tamanho).toBe(100);
      });

      it('revalida por ETag: 304 sem corpo se nada mudou e 200 quando algo muda', async () => {
        const url = `/solicitacoes?q=${marcador}&tamanho=3&pagina=1`;
        const primeira = await request(app.getHttpServer()).get(url).set(solicitante).expect(200);

        expect(primeira.headers['cache-control']).toBe('private, no-cache');
        expect(primeira.headers.etag).toBeDefined();

        const igual = await request(app.getHttpServer())
          .get(url)
          .set(solicitante)
          .set('If-None-Match', primeira.headers.etag)
          .expect(304);
        expect(igual.text).toBeFalsy();

        await request(app.getHttpServer())
          .post('/solicitacoes')
          .set(solicitante)
          .send({ titulo: `Paginacao ${marcador} novo`, descricao: 'x', categoriaId: 1 })
          .expect(201);

        const depois = await request(app.getHttpServer())
          .get(url)
          .set(solicitante)
          .set('If-None-Match', primeira.headers.etag)
          .expect(200);
        expect(depois.body.total).toBe(primeira.body.total + 1);
      });

      it('exige autenticação (401)', async () => {
        await request(app.getHttpServer()).get('/solicitacoes?pagina=1&tamanho=10').expect(401);
      });
    });

    it('consulta os detalhes completos com o histórico', async () => {
      const res = await request(app.getHttpServer())
        .get(`/solicitacoes/${codigoProprio}`)
        .set(solicitante)
        .expect(200);

      expect(res.body).toMatchObject({
        codigo: codigoProprio,
        descricao: 'Detalhe',
        status: 'ABERTO',
        categoria: { id: 1 },
        solicitante: { id: idSolicitante, usuario: 'solicitante.um' },
      });
      expect(res.body.solicitante.senha).toBeUndefined();
      expect(res.body.historico).toHaveLength(1);
      expect(res.body.historico[0]).toMatchObject({
        statusAnterior: null,
        statusNovo: 'ABERTO',
        usuario: { id: idSolicitante },
      });
    });

    it('solicitante não consulta solicitação alheia; atendente consulta (403/200/404)', async () => {
      await request(app.getHttpServer())
        .get(`/solicitacoes/${codigoAlheio}`)
        .set(solicitante)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/solicitacoes/${codigoAlheio}`)
        .set(atendente)
        .expect(200);
      await request(app.getHttpServer())
        .get('/solicitacoes/999999')
        .set(atendente)
        .expect(404);
    });

    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get('/solicitacoes').expect(401);
      await request(app.getHttpServer()).get('/solicitacoes/1').expect(401);
      await request(app.getHttpServer())
        .patch('/solicitacoes/1/status')
        .send({ status: 'EM_ATENDIMENTO' })
        .expect(401);
    });

    it('atendente avança o fluxo em sequência e gera o histórico', async () => {
      const alterar = (status: string) =>
        request(app.getHttpServer())
          .patch(`/solicitacoes/${codigoProprio}/status`)
          .set(atendente)
          .send({ status });

      await alterar('CONCLUIDO').expect(409); // não pode pular etapa
      await alterar('ABERTO').expect(409); // nem repetir
      const emAtendimento = await alterar('EM_ATENDIMENTO').expect(200);
      expect(emAtendimento.body.status).toBe('EM_ATENDIMENTO');
      await alterar('ABERTO').expect(409); // nem voltar
      await alterar('CONCLUIDO').expect(200);
      await alterar('EM_ATENDIMENTO').expect(409); // concluído é final

      const { body } = await request(app.getHttpServer())
        .get(`/solicitacoes/${codigoProprio}`)
        .set(atendente)
        .expect(200);
      expect(body.status).toBe('CONCLUIDO');
      expect(
        body.historico.map((h: { statusAnterior: string | null; statusNovo: string }) => [
          h.statusAnterior,
          h.statusNovo,
        ]),
      ).toEqual([
        [null, 'ABERTO'],
        ['ABERTO', 'EM_ATENDIMENTO'],
        ['EM_ATENDIMENTO', 'CONCLUIDO'],
      ]);
      expect(body.historico[1].usuario.nome).toBe('Atendente Um');

      // A listagem deriva atendente, última atualização e conclusão do histórico.
      const lista = await listar(atendente, `?q=${codigoProprio}`).expect(200);
      const item = lista.body.itens.find((s: { codigo: number }) => s.codigo === codigoProprio);
      expect(item.atendente).toEqual({ id: expect.any(Number), nome: 'Atendente Um' });
      expect(item.dataConclusao).toBe(body.historico[2].dataAlteracao);
      expect(item.ultimaAtualizacao).toBe(body.historico[2].dataAlteracao);
      expect(item.historico).toBeUndefined();
    });

    it('chamado sem atendimento aparece com atendente e conclusão nulos', async () => {
      const lista = await listar(atendente, `?q=${codigoAlheio}`).expect(200);
      const item = lista.body.itens.find((s: { codigo: number }) => s.codigo === codigoAlheio);

      expect(item.atendente).toBeNull();
      expect(item.dataConclusao).toBeNull();
      expect(item.ultimaAtualizacao).toBe(item.dataCriacao);
    });

    describe('dono do chamado e filtro de atendente (meus, todos, sem)', () => {
      let atendente2: { Authorization: string };
      let idAtendente1: number;
      let idAtendente2: number;
      let semAtendente: number; // ninguém assumiu
      let doUm: number; // atendente.um assumiu e continua em atendimento
      let doDois: number; // atendente.dois assumiu e continua em atendimento
      let concluidoPeloUm: number;

      const criar = async (titulo: string, categoriaId = 1) => {
        const res = await request(app.getHttpServer())
          .post('/solicitacoes')
          .set(solicitante)
          .send({ titulo: `${titulo} ${marcador}`, descricao: 'x', categoriaId })
          .expect(201);
        return res.body.codigo as number;
      };
      const mudarStatus = (quem: { Authorization: string }, codigo: number, status: string) =>
        request(app.getHttpServer())
          .patch(`/solicitacoes/${codigo}/status`)
          .set(quem)
          .send({ status });
      const noBanco = (where: object) =>
        app.get(PrismaService).solicitacao.count({
          where: { titulo: { contains: marcador }, ...where },
        });
      const assumidoPor = (usuarioId: number) => ({
        historico: { some: { statusNovo: 'EM_ATENDIMENTO' as const, usuarioId } },
      });
      const naoAssumido = { historico: { none: { statusNovo: 'EM_ATENDIMENTO' as const } } };

      beforeAll(async () => {
        const { body: a1 } = await login('atendente.um');
        const { body: a2 } = await login('atendente.dois');
        atendente2 = { Authorization: `Bearer ${a2.accessToken}` };
        idAtendente1 = a1.usuario.id;
        idAtendente2 = a2.usuario.id;

        semAtendente = await criar('Dono sem atendente A', 1);
        await criar('Dono sem atendente B', 2);
        doUm = await criar('Dono do um', 1);
        await mudarStatus(atendente, doUm, 'EM_ATENDIMENTO').expect(200);
        doDois = await criar('Dono do dois', 2);
        await mudarStatus(atendente2, doDois, 'EM_ATENDIMENTO').expect(200);
        concluidoPeloUm = await criar('Dono concluido pelo um', 1);
        await mudarStatus(atendente, concluidoPeloUm, 'EM_ATENDIMENTO').expect(200);
        await mudarStatus(atendente, concluidoPeloUm, 'CONCLUIDO').expect(200);
      });

      describe('bloqueio de concorrência no status', () => {
        it('o responsável conclui; outro atendente é barrado com 403 e nada muda', async () => {
          const codigo = await criar('Dono bloqueio');
          await mudarStatus(atendente, codigo, 'EM_ATENDIMENTO').expect(200);

          const barrado = await mudarStatus(atendente2, codigo, 'CONCLUIDO').expect(403);
          expect(barrado.body.message).toContain('Atendente Um');

          const intacto = await request(app.getHttpServer())
            .get(`/solicitacoes/${codigo}`)
            .set(atendente2)
            .expect(200);
          expect(intacto.body.status).toBe('EM_ATENDIMENTO');
          expect(intacto.body.historico).toHaveLength(2); // sem linha do atendente barrado

          const ok = await mudarStatus(atendente, codigo, 'CONCLUIDO').expect(200);
          expect(ok.body).toMatchObject({
            status: 'CONCLUIDO',
            atendente: { id: idAtendente1, nome: 'Atendente Um' },
          });
        });

        it('quem chega depois da assunção é barrado, seja qual for o status pedido', async () => {
          const codigo = await criar('Dono chegou depois');
          const assumiu = await mudarStatus(atendente2, codigo, 'EM_ATENDIMENTO').expect(200);
          expect(assumiu.body.atendente).toEqual({ id: idAtendente2, nome: 'Atendente Dois' });

          await mudarStatus(atendente, codigo, 'CONCLUIDO').expect(403);
          await mudarStatus(atendente, codigo, 'EM_ATENDIMENTO').expect(409); // já está em atendimento
          await mudarStatus(atendente, codigo, 'ABERTO').expect(409); // não volta atrás

          await mudarStatus(atendente2, codigo, 'CONCLUIDO').expect(200);
        });

        it('chamado concluído não muda mais, nem pelo responsável', async () => {
          await mudarStatus(atendente, concluidoPeloUm, 'EM_ATENDIMENTO').expect(409);
          await mudarStatus(atendente2, concluidoPeloUm, 'CONCLUIDO').expect(409);
        });

        it('duas assunções simultâneas: uma passa (200) e a outra perde (409)', async () => {
          const codigo = await criar('Dono corrida');

          const respostas = await Promise.all([
            mudarStatus(atendente, codigo, 'EM_ATENDIMENTO'),
            mudarStatus(atendente2, codigo, 'EM_ATENDIMENTO'),
          ]);
          const statuses = respostas.map((r) => r.status).sort();
          const vencedor = respostas.find((r) => r.status === 200)!;

          expect(statuses).toEqual([200, 409]);
          const assuncoes = await app.get(PrismaService).historicoSolicitacao.findMany({
            where: { solicitacaoCodigo: codigo, statusNovo: 'EM_ATENDIMENTO' },
          });
          expect(assuncoes).toHaveLength(1); // uma só linha: não há dois responsáveis
          expect(assuncoes[0].usuarioId).toBe(vencedor.body.atendente.id);

          const detalhe = await request(app.getHttpServer())
            .get(`/solicitacoes/${codigo}`)
            .set(atendente)
            .expect(200);
          expect(detalhe.body.atendente.id).toBe(vencedor.body.atendente.id);
        });

        it('o solicitante continua sem poder mudar o status (403)', async () => {
          await request(app.getHttpServer())
            .patch(`/solicitacoes/${semAtendente}/status`)
            .set(solicitante)
            .send({ status: 'EM_ATENDIMENTO' })
            .expect(403);
        });
      });

      describe('atendente no detalhe', () => {
        it('é null enquanto ninguém assumiu e traz o responsável depois', async () => {
          const aberto = await request(app.getHttpServer())
            .get(`/solicitacoes/${semAtendente}`)
            .set(atendente)
            .expect(200);
          expect(aberto.body.atendente).toBeNull();

          const assumido = await request(app.getHttpServer())
            .get(`/solicitacoes/${doDois}`)
            .set(solicitante)
            .expect(200);
          expect(assumido.body.atendente).toEqual({ id: idAtendente2, nome: 'Atendente Dois' });
        });
      });

      describe('filtro de atendente na listagem', () => {
        const total = async (auth: { Authorization: string }, query: string) => {
          const res = await listar(auth, `?q=${marcador}&${query}`).expect(200);
          return res.body as { itens: { codigo: number; atendente: { id: number } | null; status: string }[]; total: number };
        };

        it('"meus": só o que o atendente logado assumiu (resolvido pelo token)', async () => {
          const um = await total(atendente, 'atendente=meus');
          const dois = await total(atendente2, 'atendente=meus');

          expect(um.total).toBe(await noBanco(assumidoPor(idAtendente1)));
          expect(dois.total).toBe(await noBanco(assumidoPor(idAtendente2)));
          for (const item of um.itens) expect(item.atendente?.id).toBe(idAtendente1);
          for (const item of dois.itens) expect(item.atendente?.id).toBe(idAtendente2);
          expect(um.itens.map((i) => i.codigo)).toContain(doUm);
          expect(um.itens.map((i) => i.codigo)).toContain(concluidoPeloUm);
          expect(um.itens.map((i) => i.codigo)).not.toContain(doDois);
          expect(dois.itens.map((i) => i.codigo)).toContain(doDois);
        });

        it('"sem": só os chamados que ninguém assumiu', async () => {
          const res = await total(atendente, 'atendente=sem');

          expect(res.total).toBe(await noBanco(naoAssumido));
          expect(res.itens.map((i) => i.codigo)).toContain(semAtendente);
          for (const item of res.itens) {
            expect(item.atendente).toBeNull();
            expect(item.status).toBe('ABERTO');
          }
        });

        it('"todos" equivale a não filtrar e inclui os chamados dos colegas', async () => {
          const todos = await total(atendente, 'atendente=todos');
          const omitido = await total(atendente, 'tamanho=20');

          expect(todos.total).toBe(await noBanco({}));
          expect(omitido.total).toBe(todos.total);
          expect(todos.itens.map((i) => i.codigo)).toEqual(expect.arrayContaining([doUm, doDois]));
        });

        it('as 3 opções particionam o resultado: meus + dos colegas + sem = todos', async () => {
          const meus = await total(atendente, 'atendente=meus');
          const doColega = await total(atendente2, 'atendente=meus');
          const sem = await total(atendente, 'atendente=sem');
          const todos = await total(atendente, 'atendente=todos');
          const outros = await noBanco({
            historico: { some: { statusNovo: 'EM_ATENDIMENTO', usuarioId: { notIn: [idAtendente1, idAtendente2] } } },
          });

          expect(meus.total + doColega.total + outros + sem.total).toBe(todos.total);
        });

        it('combina com status, setor e paginação', async () => {
          const andamento = await total(atendente, 'atendente=meus&status=EM_ATENDIMENTO');
          expect(andamento.total).toBe(
            await noBanco({ ...assumidoPor(idAtendente1), status: 'EM_ATENDIMENTO' }),
          );

          const semNoSetor = await total(atendente, 'atendente=sem&categoriaId=2');
          expect(semNoSetor.total).toBe(await noBanco({ ...naoAssumido, categoriaId: 2 }));

          // "sem" com um status que sempre tem atendente não devolve nada.
          const impossivel = await total(atendente, 'atendente=sem&status=EM_ATENDIMENTO,CONCLUIDO');
          expect(impossivel).toMatchObject({ itens: [], total: 0 });

          const meus = await total(atendente, 'atendente=meus');
          const vistos: number[] = [];
          for (let pagina = 1; pagina <= meus.total; pagina++) {
            const res = await total(atendente, `atendente=meus&tamanho=1&pagina=${pagina}`);
            expect(res.total).toBe(meus.total); // o total acompanha o filtro em toda página
            vistos.push(res.itens[0].codigo);
          }
          expect(new Set(vistos).size).toBe(meus.total);
        });

        it('o solicitante pode usar "sem" e "todos" nos próprios chamados, mas não "meus"', async () => {
          const sem = await total(solicitante, 'atendente=sem');
          expect(sem.total).toBe(await noBanco({ ...naoAssumido, usuarioId: idSolicitante }));

          const todos = await total(solicitante, 'atendente=todos');
          expect(todos.total).toBe(await noBanco({ usuarioId: idSolicitante }));

          await listar(solicitante, '?atendente=meus').expect(400);
        });

        it('rejeita valor inválido e "atendente" junto de "atendenteId" com 400', async () => {
          for (const query of [
            '?atendente=MEUS',
            '?atendente=todos,sem',
            '?atendente=',
            `?atendente=meus&atendenteId=${idAtendente2}`,
            `?atendente=sem&atendenteId=${idAtendente2}`,
          ]) {
            await listar(atendente, query).expect(400);
          }
        });

        it('"atendenteId" continua funcionando para um atendente específico', async () => {
          const res = await total(atendente, `atendenteId=${idAtendente2}`);

          expect(res.total).toBe(await noBanco(assumidoPor(idAtendente2)));
          expect(res.itens.map((i) => i.codigo)).toContain(doDois);
        });
      });
    });

    it('solicitante não altera status (403) e status inválido dá 400', async () => {
      await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigoAlheio}/status`)
        .set(solicitante)
        .send({ status: 'EM_ATENDIMENTO' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/solicitacoes/${codigoAlheio}/status`)
        .set(atendente)
        .send({ status: 'INVALIDO' })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/solicitacoes/999999/status')
        .set(atendente)
        .send({ status: 'EM_ATENDIMENTO' })
        .expect(404);
    });
  });

  describe('dashboard (UC07)', () => {
    type Auth = { Authorization: string };
    const marcador = `DASH${Date.now()}`;
    const FUSO = 'America/Sao_Paulo';
    let solicitante: Auth;
    let atendente: Auth;
    let idSolicitante: number;
    let idAtendente: number;
    let codigoConcluido: number;

    const dash = (auth: Auth, query = '') =>
      request(app.getHttpServer()).get(`/dashboard${query}`).set(auth);
    const soma = (itens: Record<string, unknown>[], campo: string) =>
      itens.reduce((acc, item) => acc + (item[campo] as number), 0);
    const contarPorStatus = async (where: object) => {
      const prisma = app.get(PrismaService);
      const [total, abertas, emAtendimento, concluidas] = await Promise.all([
        prisma.solicitacao.count({ where }),
        prisma.solicitacao.count({ where: { ...where, status: 'ABERTO' } }),
        prisma.solicitacao.count({ where: { ...where, status: 'EM_ATENDIMENTO' } }),
        prisma.solicitacao.count({ where: { ...where, status: 'CONCLUIDO' } }),
      ]);
      return { total, abertas, emAtendimento, concluidas };
    };

    beforeAll(async () => {
      const prisma = app.get(PrismaService);
      const { body: s } = await login('solicitante.um');
      const { body: a } = await login('atendente.um');
      solicitante = { Authorization: `Bearer ${s.accessToken}` };
      atendente = { Authorization: `Bearer ${a.accessToken}` };
      idSolicitante = s.usuario.id;
      idAtendente = a.usuario.id;

      const criar = async (categoriaId: number) => {
        const res = await request(app.getHttpServer())
          .post('/solicitacoes')
          .set(solicitante)
          .send({ titulo: `Dash ${marcador}`, descricao: 'x', categoriaId })
          .expect(201);
        return res.body.codigo as number;
      };
      const avancar = (codigo: number, status: string) =>
        request(app.getHttpServer())
          .patch(`/solicitacoes/${codigo}/status`)
          .set(atendente)
          .send({ status })
          .expect(200);

      // Um aberto (TI), um em atendimento (RH) e um concluído (TI), todos do solicitante.
      await criar(1);
      await avancar(await criar(2), 'EM_ATENDIMENTO');
      codigoConcluido = await criar(1);
      await avancar(codigoConcluido, 'EM_ATENDIMENTO');
      await avancar(codigoConcluido, 'CONCLUIDO');

      // Uma solicitação de outro dono (o seed só tem um solicitante).
      await prisma.solicitacao.create({
        data: {
          titulo: `Dash alheio ${marcador}`,
          descricao: 'Outro dono',
          categoriaId: 2,
          usuarioId: idAtendente,
        },
      });
    });

    afterAll(async () => {
      await app
        .get(PrismaService)
        .solicitacao.deleteMany({ where: { titulo: { contains: marcador } } });
    });

    it('solicitante vê só as próprias e os totais batem com o banco', async () => {
      const res = await dash(solicitante).expect(200);

      expect(res.body.escopo).toBe('proprias');
      expect(res.body.totais).toEqual(
        await contarPorStatus({ usuarioId: idSolicitante }),
      );
      expect(res.body.totais.total).toBeGreaterThanOrEqual(3);
    });

    it('atendente (geral) vê tudo, incluindo a solicitação de outro dono', async () => {
      const res = await dash(atendente).expect(200);

      expect(res.body.escopo).toBe('geral');
      expect(res.body.totais).toEqual(await contarPorStatus({}));
      const doSolicitante = await dash(solicitante).expect(200);
      expect(res.body.totais.total).toBeGreaterThan(doSolicitante.body.totais.total);
    });

    it('escopo "meus" conta só o que o atendente assumiu (e abertas é sempre 0)', async () => {
      const res = await dash(atendente, '?escopo=meus').expect(200);

      const esperado = await contarPorStatus({
        historico: { some: { statusNovo: 'EM_ATENDIMENTO', usuarioId: idAtendente } },
      });
      expect(res.body.escopo).toBe('meus');
      expect(res.body.totais).toEqual(esperado);
      expect(res.body.totais.abertas).toBe(0);
      expect(res.body.totais.total).toBeGreaterThanOrEqual(2);
    });

    it('porStatus e porCategoria são coerentes com os totais', async () => {
      const { body } = await dash(atendente).expect(200);

      expect(body.porStatus).toEqual([
        { status: 'ABERTO', total: body.totais.abertas },
        { status: 'EM_ATENDIMENTO', total: body.totais.emAtendimento },
        { status: 'CONCLUIDO', total: body.totais.concluidas },
      ]);
      expect(soma(body.porCategoria, 'total')).toBe(body.totais.total);
      expect(body.porCategoria.map((c: { nome: string }) => c.nome)).toEqual(
        expect.arrayContaining(['TI', 'RH', 'Compras', 'Financeiro', 'Infraestrutura']),
      );
    });

    it.each([
      ['7d', 7],
      ['30d', 30],
    ])('preset %s: série com %i dias terminando hoje, sem lacunas e consistente', async (periodo, dias) => {
      const { body } = await dash(solicitante, `?periodo=${periodo}`).expect(200);
      const hoje = hojeNoFuso(FUSO);

      expect(body.periodo).toMatchObject({
        tipo: periodo,
        dataFim: hoje,
        dataInicio: somarDias(hoje, -(dias - 1)),
        agrupamento: 'dia',
        fuso: FUSO,
      });
      expect(body.serie).toHaveLength(dias);
      expect(body.serie[dias - 1].data).toBe(hoje);
      expect(body.serie[dias - 1].criadas).toBeGreaterThanOrEqual(3);
      expect(body.serie[dias - 1].concluidas).toBeGreaterThanOrEqual(1);
      // Tudo no período é a mesma coleção de solicitações.
      expect(soma(body.serie, 'criadas')).toBe(body.totais.total);
      expect(soma(body.serie, 'concluidas')).toBe(body.totais.concluidas);
      expect(soma(body.porCategoria, 'total')).toBe(body.totais.total);
    });

    it('preset "tudo" começa na primeira solicitação e fecha com os totais globais', async () => {
      const { body } = await dash(solicitante, '?periodo=tudo').expect(200);
      const padrao = await dash(solicitante).expect(200);

      expect(body.periodo.tipo).toBe('tudo');
      expect(body.periodo.dataFim).toBe(hojeNoFuso(FUSO));
      expect(body.totais).toEqual(await contarPorStatus({ usuarioId: idSolicitante }));
      expect(soma(body.serie, 'criadas')).toBe(body.totais.total);
      expect(padrao.body).toEqual(body); // "tudo" é o padrão
    });

    it('período personalizado no passado exclui os chamados de hoje, com zeros preenchidos', async () => {
      const { body } = await dash(
        atendente,
        '?dataInicio=2000-01-01&dataFim=2000-01-05',
      ).expect(200);

      expect(body.periodo.tipo).toBe('personalizado');
      expect(body.totais).toEqual({ total: 0, abertas: 0, emAtendimento: 0, concluidas: 0 });
      expect(body.serie).toEqual(
        ['01', '02', '03', '04', '05'].map((d) => ({
          data: `2000-01-${d}`,
          criadas: 0,
          concluidas: 0,
        })),
      );
      expect(body.porCategoria.length).toBeGreaterThanOrEqual(5);
      expect(soma(body.porCategoria, 'total')).toBe(0);
    });

    it('período personalizado que inclui hoje contém os chamados criados', async () => {
      const hoje = hojeNoFuso(FUSO);
      const { body } = await dash(
        solicitante,
        `?dataInicio=${somarDias(hoje, -1)}&dataFim=${hoje}`,
      ).expect(200);

      expect(body.serie).toHaveLength(2);
      expect(body.totais.total).toBeGreaterThanOrEqual(3);
    });

    it('filtro por setor restringe painéis, categorias e série', async () => {
      const geral = await dash(solicitante, '?periodo=30d').expect(200);
      const ti = geral.body.porCategoria.find((c: { categoriaId: number }) => c.categoriaId === 1);

      const { body } = await dash(solicitante, '?periodo=30d&categoriaId=1').expect(200);

      expect(body.porCategoria).toEqual([ti]);
      expect(body.totais).toEqual({
        total: ti.total,
        abertas: ti.abertas,
        emAtendimento: ti.emAtendimento,
        concluidas: ti.concluidas,
      });
      expect(soma(body.serie, 'criadas')).toBe(ti.total);
    });

    it('agrupamento por semana alinha os pontos às segundas-feiras', async () => {
      const { body } = await dash(solicitante, '?periodo=30d&agrupamento=semana').expect(200);

      expect(body.periodo.agrupamento).toBe('semana');
      expect(body.serie.length).toBeGreaterThanOrEqual(5);
      expect(body.serie.length).toBeLessThanOrEqual(6);
      for (const ponto of body.serie) {
        expect(new Date(`${ponto.data}T00:00:00Z`).getUTCDay()).toBe(1); // segunda
      }
      expect(soma(body.serie, 'criadas')).toBe(body.totais.total);
    });

    it('agrupamento por mês alinha os pontos ao dia 1', async () => {
      const { body } = await dash(solicitante, '?periodo=tudo&agrupamento=mes').expect(200);

      for (const ponto of body.serie) expect(ponto.data.endsWith('-01')).toBe(true);
      expect(soma(body.serie, 'criadas')).toBe(body.totais.total);
    });

    it('fuso UTC é aceito e informado na resposta', async () => {
      const { body } = await dash(solicitante, '?periodo=7d&fuso=UTC').expect(200);

      expect(body.periodo.fuso).toBe('UTC');
      expect(body.periodo.dataFim).toBe(hojeNoFuso('UTC'));
    });

    it('rejeita parâmetros inválidos com 400', async () => {
      const invalidos = [
        '?periodo=90d',
        '?periodo=7d&dataInicio=2026-09-01',
        '?dataInicio=2026-09-30&dataFim=2026-09-01',
        '?dataInicio=2026-02-30',
        '?dataInicio=01/09/2026',
        '?categoriaId=abc',
        '?agrupamento=ano',
        '?fuso=Marte/Olympus',
        '?dataInicio=2020-01-01&dataFim=2026-09-30&agrupamento=dia', // pontos demais
        '?foo=1',
      ];
      for (const query of invalidos) {
        await dash(atendente, query).expect(400);
      }
    });

    it('solicitante não pode usar o filtro escopo (400)', async () => {
      await dash(solicitante, '?escopo=meus').expect(400);
      await dash(solicitante, '?escopo=geral').expect(400);
    });

    it('exige autenticação (401)', async () => {
      await request(app.getHttpServer()).get('/dashboard').expect(401);
    });

    it('revalida por ETag: mesma resposta devolve 304 sem corpo e sem cache compartilhado', async () => {
      const primeira = await dash(solicitante, '?periodo=7d').expect(200);

      expect(primeira.headers['cache-control']).toBe('private, no-cache');
      expect(primeira.headers.etag).toBeDefined();

      const segunda = await request(app.getHttpServer())
        .get('/dashboard?periodo=7d')
        .set(solicitante)
        .set('If-None-Match', primeira.headers.etag)
        .expect(304);
      expect(segunda.text).toBeFalsy();

      // Mudou um dado: o ETag deixa de valer e o corpo novo volta.
      await request(app.getHttpServer())
        .post('/solicitacoes')
        .set(solicitante)
        .send({ titulo: `Dash ${marcador}`, descricao: 'novo', categoriaId: 1 })
        .expect(201);
      const terceira = await request(app.getHttpServer())
        .get('/dashboard?periodo=7d')
        .set(solicitante)
        .set('If-None-Match', primeira.headers.etag)
        .expect(200);
      expect(terceira.body.totais.total).toBe(primeira.body.totais.total + 1);
    });
  });

  describe('validação das entradas de texto e numéricas', () => {
    const marca = `VAL${Date.now()}`;
    const INT_MAX = 2_147_483_647;
    const NUL = '\u0000';
    let solicitante: { Authorization: string };
    let atendente: { Authorization: string };
    const criados: number[] = [];

    const post = (corpo: object) =>
      request(app.getHttpServer()).post('/solicitacoes').set(solicitante).send(corpo);
    const criarOk = async (titulo: string, descricao = 'descrição', categoriaId = 1) => {
      const res = await post({ titulo, descricao, categoriaId }).expect(201);
      criados.push(res.body.codigo);
      return res.body as { codigo: number; titulo: string; descricao: string };
    };
    const lista = (query: string) =>
      request(app.getHttpServer()).get(`/solicitacoes?${query}`).set(atendente);

    beforeAll(async () => {
      const { body: s } = await login('solicitante.um');
      const { body: a } = await login('atendente.um');
      solicitante = { Authorization: `Bearer ${s.accessToken}` };
      atendente = { Authorization: `Bearer ${a.accessToken}` };
    });

    afterAll(async () => {
      await app
        .get(PrismaService)
        .solicitacao.deleteMany({ where: { codigo: { in: criados } } });
    });

    describe('criar', () => {
      it('rejeita título e descrição só com espaços (400)', async () => {
        await post({ titulo: '     ', descricao: 'ok', categoriaId: 1 }).expect(400);
        await post({ titulo: 'ok', descricao: '\n  \t ', categoriaId: 1 }).expect(400);
      });

      it('apara os espaços das pontas ao gravar', async () => {
        const c = await criarOk(`  ${marca} aparado  `, '  texto  ');
        expect(c.titulo).toBe(`${marca} aparado`);
        expect(c.descricao).toBe('texto');
      });

      it('título: 255 caracteres passam e 256 dão 400', async () => {
        await criarOk('t'.repeat(255));
        await post({ titulo: 't'.repeat(256), descricao: 'x', categoriaId: 1 }).expect(400);
      });

      it('descrição: 3.500 caracteres passam e 3.501 dão 400', async () => {
        await criarOk(`${marca} descrição no limite`, 'd'.repeat(3500));
        await post({ titulo: 'x', descricao: 'd'.repeat(3501), categoriaId: 1 }).expect(400);
      });

      it('caractere nulo no título ou na descrição dá 400 (antes era 500)', async () => {
        await post({ titulo: `a${NUL}b`, descricao: 'x', categoriaId: 1 }).expect(400);
        await post({ titulo: 'x', descricao: `a${NUL}b`, categoriaId: 1 }).expect(400);
      });

      it('categoriaId acima do limite do banco dá 400 (antes era 500)', async () => {
        await post({ titulo: 'x', descricao: 'x', categoriaId: INT_MAX + 1 }).expect(400);
        await post({ titulo: 'x', descricao: 'x', categoriaId: 99999999999999 }).expect(400);
      });

      it('HTML no texto é guardado como texto e devolvido igual (o front escapa)', async () => {
        const c = await criarOk(`${marca} <b>negrito</b>`, '<script>alert(1)</script>');
        const detalhe = await request(app.getHttpServer())
          .get(`/solicitacoes/${c.codigo}`)
          .set(solicitante)
          .expect(200);
        expect(detalhe.body.descricao).toBe('<script>alert(1)</script>');
        expect(detalhe.headers['content-type']).toMatch(/application\/json/);
      });
    });

    describe('editar', () => {
      let codigo: number;
      beforeAll(async () => {
        codigo = (await criarOk(`${marca} para editar`)).codigo;
      });
      const patch = (corpo: object) =>
        request(app.getHttpServer()).patch(`/solicitacoes/${codigo}`).set(solicitante).send(corpo);

      it('rejeita texto só com espaços, acima do limite e com byte nulo (400)', async () => {
        await patch({ titulo: '    ' }).expect(400);
        await patch({ descricao: '   ' }).expect(400);
        await patch({ titulo: 't'.repeat(256) }).expect(400);
        await patch({ descricao: 'd'.repeat(3501) }).expect(400);
        await patch({ titulo: `a${NUL}b` }).expect(400);
        await patch({ descricao: `a${NUL}b` }).expect(400);
      });

      it('categoriaId acima do limite dá 400 (antes era 500)', async () => {
        await patch({ categoriaId: INT_MAX + 1 }).expect(400);
      });

      it('edição válida continua funcionando e apara os espaços', async () => {
        const res = await patch({ titulo: `  ${marca} editado  `, descricao: 'd'.repeat(3500) }).expect(200);
        expect(res.body.titulo).toBe(`${marca} editado`);
        expect(res.body.descricao).toHaveLength(3500);
      });
    });

    describe('login', () => {
      const entrar = (corpo: object) => request(app.getHttpServer()).post('/auth/login').send(corpo);

      it('rejeita usuário e senha fora dos limites e com byte nulo (400)', async () => {
        await entrar({ usuario: 'u'.repeat(256), senha: 'x' }).expect(400);
        await entrar({ usuario: 'a', senha: 's'.repeat(129) }).expect(400);
        await entrar({ usuario: `a${NUL}b`, senha: 'x' }).expect(400);
        await entrar({ usuario: 'a', senha: `a${NUL}b` }).expect(400);
        await entrar({ usuario: '   ', senha: 'x' }).expect(400);
      });

      it('credenciais erradas dentro dos limites continuam dando 401', async () => {
        await entrar({ usuario: 'u'.repeat(255), senha: 's'.repeat(128) }).expect(401);
        await entrar({ usuario: 'nao.existe', senha: 'x' }).expect(401);
      });

      it('espaços em volta do usuário são ignorados no login', async () => {
        await entrar({ usuario: '  solicitante.um  ', senha: '123456' }).expect(200);
      });
    });

    describe('busca livre (q)', () => {
      it('rejeita byte nulo (400, antes era 500)', async () => {
        await lista('q=a%00b').expect(400);
      });

      it('"%" e "_" são texto, não curingas', async () => {
        const comPorcento = await criarOk(`${marca} desconto 100% ok`);
        const semPorcento = await criarOk(`${marca} desconto 1000 ok`);
        const comUnderline = await criarOk(`${marca} arquivo a_b`);
        const semUnderline = await criarOk(`${marca} arquivo axb`);

        // Sem escape, "100%" casaria "1000" e "a_b" casaria "axb".
        const p = await lista(`q=${encodeURIComponent(`${marca} desconto 100% ok`)}`).expect(200);
        expect(p.body.itens.map((i: { codigo: number }) => i.codigo)).toEqual([comPorcento.codigo]);
        const u = await lista(`q=${encodeURIComponent(`${marca} arquivo a_b`)}`).expect(200);
        expect(u.body.itens.map((i: { codigo: number }) => i.codigo)).toEqual([comUnderline.codigo]);
        expect(semPorcento.codigo).not.toBe(comPorcento.codigo);
        expect(semUnderline.codigo).not.toBe(comUnderline.codigo);
      });

      it('um "%" sozinho já não devolve tudo', async () => {
        const total = (await lista('tamanho=1').expect(200)).body.total;
        // Contagem em SQL puro por posição do caractere: o `contains` do Prisma não escapa o "%".
        const [{ n }] = await app
          .get(PrismaService)
          .$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM solicitacoes WHERE position('%' in titulo) > 0`;
        const comPorcento = Number(n);
        const res = await lista(`q=${encodeURIComponent('%')}`).expect(200);
        expect(res.body.total).toBe(comPorcento);
        expect(res.body.total).toBeLessThan(total);
      });

      it('a barra invertida é texto, e a injeção de SQL não faz nada', async () => {
        await lista(`q=${encodeURIComponent('\\')}`).expect(200);
        const inj = await lista(`q=${encodeURIComponent("' OR '1'='1")}`).expect(200);
        expect(inj.body.total).toBe(0);
      });
    });

    describe('identificadores acima do limite do banco (antes davam 500)', () => {
      it.each([
        ['categoriaId', 'categoriaId=2147483648'],
        ['atendenteId', 'atendenteId=99999999999'],
      ])('listagem com %s fora do limite dá 400', async (_nome, query) => {
        await lista(query).expect(400);
      });

      it('dashboard com categoriaId fora do limite dá 400', async () => {
        await request(app.getHttpServer())
          .get('/dashboard?categoriaId=99999999999')
          .set(atendente)
          .expect(400);
      });

      it.each(['99999999999', '2147483648', '0', '-1', 'abc', '1.5'])(
        'rota com código %s dá 400 em GET, PATCH, status e DELETE',
        async (valor) => {
          const http = request(app.getHttpServer());
          await http.get(`/solicitacoes/${valor}`).set(atendente).expect(400);
          await request(app.getHttpServer())
            .patch(`/solicitacoes/${valor}`)
            .set(solicitante)
            .send({ titulo: 'x' })
            .expect(400);
          await request(app.getHttpServer())
            .patch(`/solicitacoes/${valor}/status`)
            .set(atendente)
            .send({ status: 'EM_ATENDIMENTO' })
            .expect(400);
          await request(app.getHttpServer()).delete(`/solicitacoes/${valor}`).set(solicitante).expect(400);
        },
      );

      it('o maior código válido responde 404 (existe como formato, não como chamado)', async () => {
        await request(app.getHttpServer())
          .get(`/solicitacoes/${INT_MAX}`)
          .set(atendente)
          .expect(404);
      });
    });
  });
});
