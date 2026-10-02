import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class CriarSolicitacaoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  titulo!: string;

  @IsString()
  @IsNotEmpty()
  descricao!: string;

  @IsInt()
  @Min(1)
  categoriaId!: number;
}
