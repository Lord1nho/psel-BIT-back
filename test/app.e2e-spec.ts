import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// Requer Postgres no ar com migrations e seed aplicados.
describe('Autenticação e solicitações (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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

    expect(res.body).toMatchObject({
      status: 'ABERTO',
      usuarioId: sessao.usuario.id,
    });
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

    const criar = async () => {
      const res = await request(app.getHttpServer())
        .post('/solicitacoes')
        .set(auth)
        .send({ titulo: 'Original', descricao: 'Descrição', categoriaId: 1 })
        .expect(201);
      return res.body.codigo as number;
    };

    beforeAll(async () => {
      const { body } = await login('solicitante.um');
      auth = { Authorization: `Bearer ${body.accessToken}` };
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
      await app
        .get(PrismaService)
        .solicitacao.update({ where: { codigo }, data: { status: 'EM_ATENDIMENTO' } });

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

    const listar = (auth: { Authorization: string }, query = '') =>
      request(app.getHttpServer()).get(`/solicitacoes${query}`).set(auth);
    const codigos = (body: { codigo: number }[]) => body.map((s) => s.codigo);

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

      expect(codigos(res.body)).toContain(codigoProprio);
      expect(codigos(res.body)).not.toContain(codigoAlheio);
      for (const item of res.body) {
        expect(item.solicitante.id).toBe(idSolicitante);
        expect(item.categoria).toEqual({ id: expect.any(Number), nome: expect.any(String) });
        expect(item.usuario).toBeUndefined();
      }
    });

    it('atendente lista todas', async () => {
      const res = await listar(atendente).expect(200);

      expect(codigos(res.body)).toEqual(
        expect.arrayContaining([codigoProprio, codigoAlheio]),
      );
    });

    it('busca livre acha por parte do título, por solicitante e por código', async () => {
      const parteTitulo = await listar(atendente, `?q=notebook ${marcador.slice(0, 8)}`).expect(200);
      expect(codigos(parteTitulo.body)).toContain(codigoProprio);
      expect(codigos(parteTitulo.body)).not.toContain(codigoAlheio);

      const porSolicitante = await listar(atendente, '?q=solicitante um').expect(200);
      expect(codigos(porSolicitante.body)).toContain(codigoProprio);
      expect(codigos(porSolicitante.body)).not.toContain(codigoAlheio);

      const porCodigo = await listar(atendente, `?q=${codigoAlheio}`).expect(200);
      expect(codigos(porCodigo.body)).toContain(codigoAlheio);
    });

    it('busca livre do solicitante nunca sai do próprio escopo', async () => {
      const res = await listar(solicitante, `?q=${marcador}`).expect(200);

      expect(codigos(res.body)).toEqual([codigoProprio]);
    });

    it('filtra por status, categoria e período', async () => {
      const status = await listar(atendente, `?status=CONCLUIDO&q=${marcador}`).expect(200);
      expect(status.body).toEqual([]);

      const categoria = await listar(atendente, `?categoriaId=2&q=${marcador}`).expect(200);
      expect(codigos(categoria.body)).toEqual([codigoAlheio]);

      const hoje = new Date().toISOString().slice(0, 10);
      const noPeriodo = await listar(atendente, `?dataInicio=${hoje}&dataFim=${hoje}&q=${marcador}`).expect(200);
      expect(codigos(noPeriodo.body)).toEqual(
        expect.arrayContaining([codigoProprio, codigoAlheio]),
      );

      const futuro = await listar(atendente, `?dataInicio=2999-01-01&q=${marcador}`).expect(200);
      expect(futuro.body).toEqual([]);
      const passado = await listar(atendente, `?dataFim=2000-01-01&q=${marcador}`).expect(200);
      expect(passado.body).toEqual([]);
    });

    it('rejeita filtros inválidos com 400', async () => {
      await listar(atendente, '?status=XYZ').expect(400);
      await listar(atendente, '?categoriaId=abc').expect(400);
      await listar(atendente, '?dataInicio=01/09/2026').expect(400);
      await listar(atendente, '?dataInicio=2026-09-30&dataFim=2026-09-01').expect(400);
      await listar(atendente, '?usuarioId=1').expect(400);
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
});
