import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { INT_MAX } from '../validacao/limites.js';

// Parâmetro de rota que é um identificador: inteiro positivo que cabe no integer do banco.
// Substitui o ParseIntPipe, que aceitava 0, negativos e números acima do limite do banco (500).
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(valor: string): number {
    const id = /^\d+$/.test(valor) ? Number(valor) : NaN;
    if (!Number.isSafeInteger(id) || id < 1 || id > INT_MAX) {
      throw new BadRequestException(
        `O código deve ser um número inteiro entre 1 e ${INT_MAX}`,
      );
    }
    return id;
  }
}
