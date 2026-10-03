import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { INT_MAX, LIMITES } from '../../common/validacao/limites.js';
import { CriarComentarioDto } from './criar-comentario.dto.js';
import { EditarComentarioDto } from './editar-comentario.dto.js';
import { FiltrarComentariosDto } from './filtrar-comentarios.dto.js';

// Mesmas opções do ValidationPipe global (src/configurar-app.ts).
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const validar = <T>(tipo: 'body' | 'query', metatype: new () => T, valor: unknown) =>
  pipe.transform(valor, { type: tipo, metatype }) as Promise<T>;

describe.each([
  ['CriarComentarioDto', CriarComentarioDto],
  ['EditarComentarioDto', EditarComentarioDto],
])('%s', (_nome, Dto) => {
  const corpo = (texto: unknown) => validar('body', Dto as new () => { texto: string }, { texto });

  it('aceita texto e remove espaços das pontas', async () => {
    expect((await corpo('  Olá  ')).texto).toBe('Olá');
  });

  it.each([[''], ['   '], ['\n\t ']])('recusa vazio ou só espaços (%j)', async (texto) => {
    await expect(corpo(texto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita exatamente o limite e recusa um a mais', async () => {
    await expect(corpo('a'.repeat(LIMITES.comentario))).resolves.toBeDefined();
    await expect(corpo('a'.repeat(LIMITES.comentario + 1))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa o caractere nulo, tipo errado e campo desconhecido', async () => {
    await expect(corpo('a\u0000b')).rejects.toBeInstanceOf(BadRequestException);
    await expect(corpo(123)).rejects.toBeInstanceOf(BadRequestException);
    await expect(corpo(null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validar('body', Dto as new () => object, { texto: 'ok', autorId: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FiltrarComentariosDto', () => {
  const consulta = (query: Record<string, unknown>) =>
    validar('query', FiltrarComentariosDto, query);

  it('converte proxComentario e limite para número', async () => {
    expect(await consulta({ proxComentario: '42', limite: '10' })).toMatchObject({
      proxComentario: 42,
      limite: 10,
    });
  });

  it('tudo é opcional', async () => {
    await expect(consulta({})).resolves.toBeDefined();
  });

  it.each([['0'], ['-1'], ['abc'], ['1.5'], [String(INT_MAX + 1)]])(
    'recusa proxComentario inválido (%s)',
    async (valor) => {
      await expect(consulta({ proxComentario: valor })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it.each([['0'], ['101'], ['abc']])('recusa limite inválido (%s)', async (valor) => {
    await expect(consulta({ limite: valor })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita o limite máximo de 100', async () => {
    await expect(consulta({ limite: '100' })).resolves.toBeDefined();
  });
});
