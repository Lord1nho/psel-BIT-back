import { CategoriasService } from './categorias.service.js';

describe('CategoriasService', () => {
  const findMany = vi.fn();
  let service: CategoriasService;

  beforeEach(() => {
    findMany.mockReset();
    service = new CategoriasService({ categoria: { findMany } } as never);
  });

  it('lista só as ativas, ordenadas por id, com id e nome', async () => {
    const categorias = [
      { id: 1, nome: 'TI' },
      { id: 2, nome: 'RH' },
    ];
    findMany.mockResolvedValue(categorias);

    await expect(service.listarAtivas()).resolves.toEqual(categorias);
    expect(findMany).toHaveBeenCalledWith({
      where: { ativa: true },
      orderBy: { id: 'asc' },
      select: { id: true, nome: true },
    });
  });
});
