import { deveSemear } from './demo-guarda.js';

describe('deveSemear', () => {
  it('com --se-vazio semeia só se não houver nenhum chamado', () => {
    expect(deveSemear(0, true)).toBe(true);
    expect(deveSemear(1, true)).toBe(false);
    expect(deveSemear(150, true)).toBe(false);
  });

  it('sem --se-vazio deixa a decisão para a guarda original', () => {
    expect(deveSemear(0, false)).toBe(true);
    expect(deveSemear(150, false)).toBe(true);
  });
});
