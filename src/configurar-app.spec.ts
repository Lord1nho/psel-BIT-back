import { parseOrigensCors } from './configurar-app.js';

describe('parseOrigensCors', () => {
  it('separa por vírgula e remove espaços', () => {
    expect(
      parseOrigensCors(' http://localhost:5173 , https://app.exemplo.com '),
    ).toEqual(['http://localhost:5173', 'https://app.exemplo.com']);
  });

  it('aceita uma única origem', () => {
    expect(parseOrigensCors('http://localhost:5173')).toEqual([
      'http://localhost:5173',
    ]);
  });

  it.each([undefined, '', '  ', ' , '])(
    'sem origem configurada (%j) não libera ninguém',
    (valor) => {
      expect(parseOrigensCors(valor)).toEqual([]);
    },
  );
});
