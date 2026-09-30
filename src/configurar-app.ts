import { INestApplication, ValidationPipe } from '@nestjs/common';

// "http://a.com, http://b.com" → ['http://a.com', 'http://b.com']; vazio → [].
export function parseOrigensCors(valor?: string): string[] {
  return (valor ?? '')
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean);
}

export function configurarApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Sem CORS_ORIGIN nenhuma origem é liberada (nunca "*"). O token vai no
  // header Authorization, então não há cookies nem `credentials`.
  app.enableCors({
    origin: parseOrigensCors(process.env.CORS_ORIGIN),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}
