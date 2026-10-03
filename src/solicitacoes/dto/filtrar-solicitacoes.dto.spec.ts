import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { FiltrarSolicitacoesDto } from './filtrar-solicitacoes.dto.js';

// Mesmas opções do ValidationPipe global (src/configurar-app.ts).
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const converter = (query: Record<string, unknown>) =>
  pipe.transform(query, {
    type: 'query',
    metatype: FiltrarSolicitacoesDto,
  }) as Promise<FiltrarSolicitacoesDto>;

describe('FiltrarSolicitacoesDto', () => {
  describe('status', () => {
    it('aceita um valor só (como antes), já em lista', async () => {
      expect((await converter({ status: 'ABERTO' })).status).toEqual(['ABERTO']);
    });

    it('aceita vários separados por vírgula', async () => {
      expect(
        (await converter({ status: 'ABERTO,EM_ATENDIMENTO' })).status,
      ).toEqual(['ABERTO', 'EM_ATENDIMENTO']);
    });

    it('aceita o parâmetro repetido (status=A&status=B)', async () => {
      expect(
        (await converter({ status: ['ABERTO', 'EM_ATENDIMENTO'] })).status,
      ).toEqual(['ABERTO', 'EM_ATENDIMENTO']);
    });

    it('aceita repetido combinado com vírgula', async () => {
      expect(
        (await converter({ status: ['ABERTO,EM_ATENDIMENTO', 'CONCLUIDO'] })).status,
      ).toEqual(['ABERTO', 'EM_ATENDIMENTO', 'CONCLUIDO']);
    });

    it('ignora repetidos e espaços', async () => {
      expect(
        (await converter({ status: ' ABERTO , ABERTO,ABERTO ' })).status,
      ).toEqual(['ABERTO']);
    });

    it.each([[''], [' '], [','], [[]], [['', ' ']]])(
      'valor vazio (%j) equivale a não filtrar',
      async (status) => {
        expect((await converter({ status })).status).toBeUndefined();
      },
    );

    it('sem o parâmetro não filtra', async () => {
      expect((await converter({})).status).toBeUndefined();
    });

    it.each([['XYZ'], ['aberto'], ['ABERTO,XYZ'], [['ABERTO', 'XYZ']]])(
      'rejeita valor fora do enum (%j) com 400',
      async (status) => {
        await expect(converter({ status })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );
  });

  describe('atendente (meus | todos | sem)', () => {
    it.each([['meus'], ['todos'], ['sem']])('aceita %j', async (atendente) => {
      expect((await converter({ atendente })).atendente).toBe(atendente);
    });

    it('é opcional', async () => {
      expect((await converter({})).atendente).toBeUndefined();
    });

    it.each([['MEUS'], ['outro'], [''], ['meus,sem'], ['1'], [['meus', 'sem']]])(
      'rejeita %j com 400',
      async (atendente) => {
        await expect(converter({ atendente })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );
  });

  describe('atendenteId', () => {
    it('converte o texto da query em número', async () => {
      expect((await converter({ atendenteId: '9' })).atendenteId).toBe(9);
    });

    it('é opcional', async () => {
      expect((await converter({})).atendenteId).toBeUndefined();
    });

    it.each([['0'], ['-1'], ['abc'], ['1.5'], ['']])(
      'rejeita atendenteId %j com 400',
      async (atendenteId) => {
        await expect(converter({ atendenteId })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );
  });

  describe('paginação', () => {
    it('converte pagina e tamanho (vêm como texto na query) em número', async () => {
      const dto = await converter({ pagina: '2', tamanho: '50' });

      expect(dto.pagina).toBe(2);
      expect(dto.tamanho).toBe(50);
    });

    it('são opcionais', async () => {
      const dto = await converter({});

      expect(dto.pagina).toBeUndefined();
      expect(dto.tamanho).toBeUndefined();
    });

    it('aceita os limites: tamanho 1 e 100, página 1', async () => {
      await expect(converter({ pagina: '1', tamanho: '1' })).resolves.toBeDefined();
      await expect(converter({ tamanho: '100' })).resolves.toBeDefined();
    });

    it.each([['0'], ['-1'], ['abc'], ['1.5'], [''], ['1000001']])(
      'rejeita pagina %j com 400',
      async (pagina) => {
        await expect(converter({ pagina })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    it.each([['0'], ['101'], ['-5'], ['abc'], ['2.5'], ['']])(
      'rejeita tamanho %j com 400',
      async (tamanho) => {
        await expect(converter({ tamanho })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );
  });

  it('continua rejeitando parâmetro desconhecido', async () => {
    await expect(converter({ usuarioId: '1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(converter({ offset: '10' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('os filtros anteriores seguem funcionando junto da paginação', async () => {
    const dto = await converter({
      categoriaId: '2',
      q: '  note ',
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      status: 'ABERTO,EM_ATENDIMENTO',
      pagina: '3',
      tamanho: '10',
    });

    expect(dto).toMatchObject({
      categoriaId: 2,
      q: 'note',
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      status: ['ABERTO', 'EM_ATENDIMENTO'],
      pagina: 3,
      tamanho: 10,
    });
  });
});
