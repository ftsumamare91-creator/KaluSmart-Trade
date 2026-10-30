
import 'reflect-metadata';

import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser = require('cookie-parser');
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { isProduction, validateEnv } from './common/config';
import { RateLimiter } from './common/rate-limit';
import { SESSION_COOKIE } from './common/auth.guard';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // 1. Validate required environment variables
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is missing. Check apps/api/.env',
    );
  }

  validateEnv();

  // 2. Create the NestJS application
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());

  // 3. Parse cookies
  app.use(cookieParser());

  // 4. API prefix
  app.setGlobalPrefix('api');

  // 5. Configure CORS for the frontend
  const allowedOrigins = (
    process.env.WEB_ORIGIN ||
    'http://localhost:3000,http://127.0.0.1:3000'
  )
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  /** In development any loopback origin (any port) is trusted, so the app works whether
   *  the browser reaches it as localhost, 127.0.0.1 or [::1]. Production stays strict. */
  const isLoopbackOrigin = (origin: string): boolean => isProduction()
    ? false
    : /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin.replace(/\/$/, ''));

  const originAllowed = (origin: string): boolean =>
    allowedOrigins.includes(origin.replace(/\/$/, '')) || isLoopbackOrigin(origin);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header, such as some CLI tools.
      if (!origin) {
        return callback(null, true);
      }

      if (originAllowed(origin)) {
        return callback(null, true);
      }

      // Callback(null, false) omits the CORS headers, so the browser still blocks the
      // request; throwing an Error here would turn every such request into a bare 500.
      logger.warn(`Blocked CORS origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: [
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
    ],
    optionsSuccessStatus: 204,
  });

  // 6a. Abuse protection: per-IP request budget, and refuse cross-site writes that carry the session cookie.
  if (process.env.TRUST_PROXY === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  const globalLimiter = new RateLimiter(300, 60_000);
  app.use((req: any, res: any, next: any) => {
    try {
      globalLimiter.consume(req.ip || 'unknown');
    } catch {
      return res.status(429).json({ statusCode: 429, message: 'Too many requests. Try again shortly.' });
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.cookies?.[SESSION_COOKIE] && req.headers.origin) {
      if (!originAllowed(String(req.headers.origin))) {
        return res.status(403).json({ statusCode: 403, message: 'Cross-site request blocked' });
      }
    }
    next();
  });

  // 6. Validate incoming request data
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 7. Swagger API documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('KaluSmart Trade API')
    .setDescription('KaluSmart Trade backend API documentation')
    .setVersion('1.1')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    swaggerConfig,
  );

  if (!isProduction() || process.env.ENABLE_SWAGGER === 'true') {
    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  // 8. Start server
  const port = Number(process.env.PORT || 4000);

  await app.listen(port, '0.0.0.0');

  logger.log(`KaluSmart Trade API running at http://localhost:${port}/api`);
  logger.log(`Swagger documentation: http://localhost:${port}/api/docs`);
  logger.log(`Allowed frontend origins: ${allowedOrigins.join(', ')}`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');

  logger.error(
    error instanceof Error ? error.message : String(error),
  );

  process.exitCode = 1;
});
