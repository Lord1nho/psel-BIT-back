import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
} from 'class-validator';
import { INT_MAX } from './limites.js';

// O Postgres não aceita o caractere nulo (U+0000) em texto: sem esta checagem ele vira erro 500.
export const SemByteNulo = () =>
  ValidateBy({
    name: 'semByteNulo',
    validator: {
      validate: (valor: unknown) =>
        typeof valor !== 'string' || !valor.includes('\u0000'),
      defaultMessage: () =>
        '$property não pode conter o caractere nulo (U+0000)',
    },
  });

// Remove espaços nas pontas (e só quando o valor é texto: o tipo errado segue para o IsString).
export const aparar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Texto obrigatório: tipo texto, sem espaços nas pontas (então "   " conta como vazio), não vazio,
 * até `max` caracteres e sem caractere nulo. Use `{ aparar: false }` quando os espaços importam
 * (senha).
 */
export function TextoObrigatorio(
  max: number,
  opcoes: { aparar?: boolean } = {},
) {
  return applyDecorators(
    ...(opcoes.aparar === false ? [] : [Transform(aparar)]),
    IsString(),
    IsNotEmpty(),
    MaxLength(max),
    SemByteNulo(),
  );
}

// Mesmas regras, mas o campo pode ser omitido (edição parcial).
export function TextoOpcional(max: number, opcoes: { aparar?: boolean } = {}) {
  return applyDecorators(IsOptional(), TextoObrigatorio(max, opcoes));
}

// Identificador inteiro positivo que cabe no integer do banco.
export const IdInteiro = () => applyDecorators(IsInt(), Min(1), Max(INT_MAX));
