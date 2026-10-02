import { BadRequestException } from '@nestjs/common';
import {
  MAX_PONTOS,
  contarPontos,
  dataValida,
  diasNoIntervalo,
  escolherAgrupamento,
  fusoValido,
  hojeNoFuso,
  precisaDaPrimeiraData,
  resolverPeriodo,
  somarDias,
} from './periodo.js';

describe('periodo', () => {
  describe('datas', () => {
    it('somarDias atravessa virada de mês, de ano e ano bissexto', () => {
      expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
      expect(somarDias('2028-03-01', -1)).toBe('2028-02-29');
      expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
      expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('diasNoIntervalo conta os dois extremos', () => {
      expect(diasNoIntervalo('2026-09-30', '2026-09-30')).toBe(1);
      expect(diasNoIntervalo('2026-09-24', '2026-09-30')).toBe(7);
    });

    it('dataValida rejeita formato errado e datas inexistentes', () => {
      expect(dataValida('2026-09-30')).toBe(true);
      expect(dataValida('2026-02-29')).toBe(false);
      expect(dataValida('2026-13-45')).toBe(false);
      expect(dataValida('30/09/2026')).toBe(false);
    });

    it('hojeNoFuso respeita o fuso: 01h UTC ainda é o dia anterior em São Paulo', () => {
      const agora = new Date('2026-10-01T01:00:00.000Z');

      expect(hojeNoFuso('UTC', agora)).toBe('2026-10-01');
      expect(hojeNoFuso('America/Sao_Paulo', agora)).toBe('2026-09-30');
    });

    it('fusoValido aceita nomes IANA e rejeita lixo', () => {
      expect(fusoValido('America/Sao_Paulo')).toBe(true);
      expect(fusoValido('UTC')).toBe(true);
      expect(fusoValido('Marte/Olympus')).toBe(false);
      expect(fusoValido("x'; DROP TABLE solicitacoes;--")).toBe(false);
      expect(fusoValido('')).toBe(false);
    });
  });

  describe('agrupamento', () => {
    it.each([
      ['2026-09-01', '2026-09-30', 'dia'], // 30 dias
      ['2026-08-01', '2026-10-01', 'dia'], // 62 dias
      ['2026-08-01', '2026-10-02', 'semana'], // 63 dias
      ['2026-01-01', '2026-12-30', 'semana'], // 364 dias
      ['2026-01-01', '2026-12-31', 'mes'], // 365 dias
    ])('auto entre %s e %s escolhe %s', (inicio, fim, esperado) => {
      expect(escolherAgrupamento('auto', inicio, fim)).toBe(esperado);
    });

    it('respeita o agrupamento pedido', () => {
      expect(escolherAgrupamento('mes', '2026-09-28', '2026-09-30')).toBe('mes');
    });

    it('contarPontos por dia, semana e mês', () => {
      expect(contarPontos('2026-09-01', '2026-09-30', 'dia')).toBe(30);
      // 2026-09-30 é quarta; semanas de 28/09, 21/09, 14/09, 07/09 e 31/08.
      expect(contarPontos('2026-09-01', '2026-09-30', 'semana')).toBe(5);
      expect(contarPontos('2026-09-28', '2026-09-30', 'semana')).toBe(1);
      expect(contarPontos('2026-01-15', '2026-03-02', 'mes')).toBe(3);
      expect(contarPontos('2025-12-31', '2026-01-01', 'mes')).toBe(2);
    });
  });

  describe('resolverPeriodo', () => {
    const hoje = '2026-09-30';

    it('7d e 30d incluem hoje e contam os dias inclusive', () => {
      expect(resolverPeriodo({ periodo: '7d' }, hoje)).toEqual({
        tipo: '7d',
        dataInicio: '2026-09-24',
        dataFim: '2026-09-30',
        agrupamento: 'dia',
      });
      const trinta = resolverPeriodo({ periodo: '30d' }, hoje);
      expect(trinta.dataInicio).toBe('2026-09-01');
      expect(diasNoIntervalo(trinta.dataInicio, trinta.dataFim)).toBe(30);
    });

    it('30d atravessa a virada de ano', () => {
      const r = resolverPeriodo({ periodo: '30d' }, '2026-01-10');

      expect(r.dataInicio).toBe('2025-12-12');
    });

    it('sem nada informado vale "tudo": da primeira solicitação até hoje', () => {
      const r = resolverPeriodo({}, hoje, '2026-08-20');

      expect(r).toMatchObject({
        tipo: 'tudo',
        dataInicio: '2026-08-20',
        dataFim: hoje,
        agrupamento: 'dia',
      });
    });

    it('"tudo" sem nenhuma solicitação cai em hoje', () => {
      const r = resolverPeriodo({ periodo: 'tudo' }, hoje, null);

      expect(r).toMatchObject({ dataInicio: hoje, dataFim: hoje });
    });

    it('"tudo" com histórico longo agrupa por semana ou mês', () => {
      expect(resolverPeriodo({}, hoje, '2026-03-01').agrupamento).toBe('semana');
      expect(resolverPeriodo({}, hoje, '2023-01-01').agrupamento).toBe('mes');
    });

    it('personalizado com os dois limites', () => {
      const r = resolverPeriodo(
        { dataInicio: '2026-09-01', dataFim: '2026-09-15' },
        hoje,
      );

      expect(r).toMatchObject({
        tipo: 'personalizado',
        dataInicio: '2026-09-01',
        dataFim: '2026-09-15',
      });
    });

    it('personalizado só com início: fim = hoje', () => {
      expect(resolverPeriodo({ dataInicio: '2026-09-10' }, hoje)).toMatchObject({
        dataInicio: '2026-09-10',
        dataFim: hoje,
      });
    });

    it('personalizado só com fim: início = primeira solicitação', () => {
      expect(
        resolverPeriodo({ dataFim: '2026-09-15' }, hoje, '2026-09-02'),
      ).toMatchObject({ dataInicio: '2026-09-02', dataFim: '2026-09-15' });
    });

    it('só com fim anterior à primeira solicitação, o início acompanha o fim', () => {
      expect(
        resolverPeriodo({ dataFim: '2026-08-01' }, hoje, '2026-09-02'),
      ).toMatchObject({ dataInicio: '2026-08-01', dataFim: '2026-08-01' });
    });

    it('só com início no futuro, o fim acompanha o início', () => {
      expect(
        resolverPeriodo({ dataInicio: '2026-10-05' }, hoje),
      ).toMatchObject({ dataInicio: '2026-10-05', dataFim: '2026-10-05' });
    });

    it('rejeita periodo junto de datas', () => {
      expect(() =>
        resolverPeriodo({ periodo: '7d', dataInicio: '2026-09-01' }, hoje),
      ).toThrow(BadRequestException);
    });

    it('rejeita início maior que o fim e datas inexistentes', () => {
      expect(() =>
        resolverPeriodo({ dataInicio: '2026-09-30', dataFim: '2026-09-01' }, hoje),
      ).toThrow(BadRequestException);
      expect(() =>
        resolverPeriodo({ dataInicio: '2026-02-30' }, hoje),
      ).toThrow(BadRequestException);
    });

    it(`rejeita séries com mais de ${MAX_PONTOS} pontos`, () => {
      // 401 dias por dia estoura; por semana cabe.
      expect(() =>
        resolverPeriodo(
          { dataInicio: '2025-01-01', dataFim: '2026-02-05', agrupamento: 'dia' },
          hoje,
        ),
      ).toThrow(BadRequestException);
      expect(
        resolverPeriodo(
          { dataInicio: '2025-01-01', dataFim: '2026-02-05', agrupamento: 'semana' },
          hoje,
        ).agrupamento,
      ).toBe('semana');
    });

    it('agrupamento pedido prevalece sobre o automático', () => {
      expect(
        resolverPeriodo({ periodo: '7d', agrupamento: 'semana' }, hoje).agrupamento,
      ).toBe('semana');
    });
  });

  describe('precisaDaPrimeiraData', () => {
    it.each([
      [{}, true],
      [{ periodo: 'tudo' as const }, true],
      [{ periodo: '7d' as const }, false],
      [{ periodo: '30d' as const }, false],
      [{ dataInicio: '2026-09-01' }, false],
      [{ dataInicio: '2026-09-01', dataFim: '2026-09-10' }, false],
      [{ dataFim: '2026-09-10' }, true],
    ])('%j → %s', (entrada, esperado) => {
      expect(precisaDaPrimeiraData(entrada)).toBe(esperado);
    });
  });
});
