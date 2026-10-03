import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LoginDto } from '../../auth/dto/login.dto.js';
import { FiltrarDashboardDto } from '../../dashboard/dto/filtrar-dashboard.dto.js';
import { CriarSolicitacaoDto } from '../../solicitacoes/dto/criar-solicitacao.dto.js';
import { EditarSolicitacaoDto } from '../../solicitacoes/dto/editar-solicitacao.dto.js';
import { FiltrarSolicitacoesDto } from '../../solicitacoes/dto/filtrar-solicitacoes.dto.js';
import { ParseIdPipe } from '../pipes/parse-id.pipe.js';
import { INT_MAX, LIMITES } from './limites.js';
import { escaparCuringasLike } from './like.js';

// Mesmas opções do ValidationPipe global (src/configurar-app.ts).
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validar = <T>(
  tipo: 'body' | 'query',
  metatype: new () => T,
  dados: unknown,
) => pipe.transform(dados, { type: tipo, metatype }) as Promise<T>;
const rejeita = async (promessa: Promise<unknown>) =>
  expect(promessa).rejects.toBeInstanceOf(BadRequestException);

const NUL = '\u0000';
const valido = {
  titulo: 'Notebook lento',
  descricao: 'Trava no Excel',
  categoriaId: 1,
};

describe('limites de validação', () => {
  it('descrição tem teto de 3.500 caracteres e título de 255', () => {
    expect(LIMITES.descricao).toBe(3500);
    expect(LIMITES.titulo).toBe(255);
    expect(INT_MAX).toBe(2_147_483_647);
  });
});

describe('CriarSolicitacaoDto', () => {
  const criar = (parcial: object) =>
    validar('body', CriarSolicitacaoDto, { ...valido, ...parcial });

  it('aceita um chamado válido', async () => {
    await expect(criar({})).resolves.toMatchObject(valido);
  });

  it('remove espaços nas pontas de título e descrição', async () => {
    const dto = await criar({
      titulo: '  Notebook  ',
      descricao: '\n texto \t',
    });
    expect(dto.titulo).toBe('Notebook');
    expect(dto.descricao).toBe('texto');
  });

  it.each([[''], ['   '], ['\t\n '], [' ']])(
    'título vazio ou só com espaços (%j) é rejeitado',
    async (titulo) => {
      await rejeita(criar({ titulo }));
    },
  );

  it.each([[''], ['     '], ['\n\n']])(
    'descrição vazia ou só com espaços (%j) é rejeitada',
    async (descricao) => {
      await rejeita(criar({ descricao }));
    },
  );

  it('título: 255 caracteres passam, 256 não', async () => {
    await expect(criar({ titulo: 't'.repeat(255) })).resolves.toBeDefined();
    await rejeita(criar({ titulo: 't'.repeat(256) }));
  });

  it('descrição: 3.500 caracteres passam, 3.501 não', async () => {
    await expect(criar({ descricao: 'd'.repeat(3500) })).resolves.toBeDefined();
    await rejeita(criar({ descricao: 'd'.repeat(3501) }));
  });

  it('o limite é contado depois de remover os espaços das pontas', async () => {
    await expect(
      criar({ descricao: ` ${'d'.repeat(3500)} ` }),
    ).resolves.toBeDefined();
  });

  it('emojis contam como um caractere cada (como o VarChar do banco)', async () => {
    await expect(criar({ titulo: '😀'.repeat(255) })).resolves.toBeDefined();
    await rejeita(criar({ titulo: '😀'.repeat(256) }));
  });

  it('caractere nulo no título ou na descrição é rejeitado (o Postgres daria 500)', async () => {
    await rejeita(criar({ titulo: `a${NUL}b` }));
    await rejeita(criar({ descricao: `a${NUL}b` }));
  });

  it('aceita quebra de linha, tab, acentos e HTML como texto', async () => {
    const dto = await criar({
      titulo: 'ação\ttab',
      descricao: 'linha 1\nlinha 2 <b>x</b> & "aspas"',
    });
    expect(dto.descricao).toContain('<b>x</b>');
  });

  it.each([[123], [['a']], [{ a: 1 }], [null], [true]])(
    'título que não é texto (%j) é rejeitado',
    async (titulo) => {
      await rejeita(criar({ titulo }));
    },
  );

  it.each([[0], [-1], [1.5], ['1'], [null], [NaN]])(
    'categoriaId inválido (%j) é rejeitado',
    async (categoriaId) => {
      await rejeita(criar({ categoriaId }));
    },
  );

  it('categoriaId: INT_MAX passa, INT_MAX + 1 não (antes dava 500 no banco)', async () => {
    await expect(criar({ categoriaId: INT_MAX })).resolves.toBeDefined();
    await rejeita(criar({ categoriaId: INT_MAX + 1 }));
    await rejeita(criar({ categoriaId: 99999999999999 }));
  });

  it('campo extra é rejeitado', async () => {
    await rejeita(criar({ usuarioId: 1 }));
  });
});

describe('EditarSolicitacaoDto', () => {
  const editar = (dados: object) =>
    validar('body', EditarSolicitacaoDto, dados);

  it('aceita edição parcial e apara os espaços', async () => {
    await expect(editar({ titulo: '  Novo  ' })).resolves.toMatchObject({
      titulo: 'Novo',
    });
    await expect(editar({ categoriaId: 2 })).resolves.toBeDefined();
  });

  it('título só com espaços, 256 caracteres e byte nulo são rejeitados', async () => {
    await rejeita(editar({ titulo: '    ' }));
    await rejeita(editar({ titulo: 't'.repeat(256) }));
    await rejeita(editar({ titulo: `a${NUL}b` }));
  });

  it('descrição: 3.500 passam; 3.501, só espaços e byte nulo não', async () => {
    await expect(
      editar({ descricao: 'd'.repeat(3500) }),
    ).resolves.toBeDefined();
    await rejeita(editar({ descricao: 'd'.repeat(3501) }));
    await rejeita(editar({ descricao: '   ' }));
    await rejeita(editar({ descricao: `a${NUL}b` }));
  });

  it('categoriaId acima do limite do banco é rejeitado', async () => {
    await expect(editar({ categoriaId: INT_MAX })).resolves.toBeDefined();
    await rejeita(editar({ categoriaId: INT_MAX + 1 }));
  });

  it('não aceita status nem usuário', async () => {
    await rejeita(editar({ status: 'CONCLUIDO' }));
    await rejeita(editar({ usuarioId: 1 }));
  });
});

describe('LoginDto', () => {
  const login = (dados: object) => validar('body', LoginDto, dados);

  it('aceita credenciais normais e apara o usuário, mas não a senha', async () => {
    const dto = await login({ usuario: '  atendente.um ', senha: ' 123456 ' });
    expect(dto.usuario).toBe('atendente.um');
    expect(dto.senha).toBe(' 123456 ');
  });

  it('usuário: vazio, só espaços, 256 caracteres e byte nulo são rejeitados', async () => {
    await rejeita(login({ usuario: '', senha: 'x' }));
    await rejeita(login({ usuario: '   ', senha: 'x' }));
    await rejeita(login({ usuario: 'u'.repeat(256), senha: 'x' }));
    await rejeita(login({ usuario: `a${NUL}b`, senha: 'x' }));
    await expect(
      login({ usuario: 'u'.repeat(255), senha: 'x' }),
    ).resolves.toBeDefined();
  });

  it('senha: vazia, acima de 128 e com byte nulo são rejeitadas; 128 passa', async () => {
    await rejeita(login({ usuario: 'a', senha: '' }));
    await rejeita(login({ usuario: 'a', senha: 's'.repeat(129) }));
    await rejeita(login({ usuario: 'a', senha: `a${NUL}b` }));
    await expect(
      login({ usuario: 'a', senha: 's'.repeat(128) }),
    ).resolves.toBeDefined();
  });

  it('tipos errados e campos extras são rejeitados', async () => {
    await rejeita(login({ usuario: 123, senha: 'x' }));
    await rejeita(login({ usuario: ['a'], senha: 'x' }));
    await rejeita(login({ usuario: { $ne: null }, senha: 'x' }));
    await rejeita(login({ usuario: 'a', senha: 'x', admin: true }));
  });
});

describe('filtros da listagem e do dashboard', () => {
  const listar = (q: object) => validar('query', FiltrarSolicitacoesDto, q);
  const dashboard = (q: object) => validar('query', FiltrarDashboardDto, q);

  it('q: rejeita byte nulo, mais de 100 caracteres e repetido; aceita curingas como texto', async () => {
    await rejeita(listar({ q: `a${NUL}b` }));
    await rejeita(listar({ q: 'a'.repeat(101) }));
    await rejeita(listar({ q: ['a', 'b'] }));
    await expect(listar({ q: '%' })).resolves.toMatchObject({ q: '%' });
    await expect(listar({ q: '  100%  ' })).resolves.toMatchObject({
      q: '100%',
    });
  });

  it.each(['categoriaId', 'atendenteId'])(
    '%s: INT_MAX passa, acima não',
    async (campo) => {
      await expect(listar({ [campo]: String(INT_MAX) })).resolves.toBeDefined();
      await rejeita(listar({ [campo]: String(INT_MAX + 1) }));
      await rejeita(listar({ [campo]: '99999999999' }));
    },
  );

  it('dashboard: categoriaId acima do limite do banco é rejeitado', async () => {
    await expect(
      dashboard({ categoriaId: String(INT_MAX) }),
    ).resolves.toBeDefined();
    await rejeita(dashboard({ categoriaId: '99999999999' }));
  });
});

describe('ParseIdPipe', () => {
  const pipeId = new ParseIdPipe();

  it('converte inteiros positivos até o limite do banco', () => {
    expect(pipeId.transform('1')).toBe(1);
    expect(pipeId.transform('42')).toBe(42);
    expect(pipeId.transform(String(INT_MAX))).toBe(INT_MAX);
  });

  it.each([
    ['0'],
    ['-1'],
    ['abc'],
    ['1.5'],
    ['1e3'],
    [''],
    [' 1'],
    ['0x10'],
    ['+1'],
    [String(INT_MAX + 1)],
    ['99999999999'],
    ['9'.repeat(400)],
  ])('rejeita %j com 400', (valor) => {
    expect(() => pipeId.transform(valor)).toThrow(BadRequestException);
  });
});

describe('escaparCuringasLike', () => {
  it('escapa %, _ e a barra, e não mexe no resto', () => {
    expect(escaparCuringasLike('100%')).toBe('100\\%');
    expect(escaparCuringasLike('a_b')).toBe('a\\_b');
    expect(escaparCuringasLike('c:\\dir')).toBe('c:\\\\dir');
    expect(escaparCuringasLike('%_\\')).toBe('\\%\\_\\\\');
    expect(escaparCuringasLike('texto normal 123')).toBe('texto normal 123');
    expect(escaparCuringasLike('')).toBe('');
  });
});
