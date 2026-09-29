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
});
