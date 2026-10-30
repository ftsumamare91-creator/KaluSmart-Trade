import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const PRISMA_ERRORS: Record<string, [number, string]> = {
  P2002: [409, 'A record with this value already exists.'],
  P2003: [400, 'A related record does not exist.'],
  P2025: [404, 'The requested record was not found.'],
};

/** Logs the real cause on the server; the client gets a clear message instead of a bare 500. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      // The query shape was wrong. The details can contain user input, so only the fact is logged.
      this.logger.warn('Prisma rejected a query built from the request');
      res.status(400).json({ statusCode: 400, message: 'Invalid request data.' });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const [status, message] = PRISMA_ERRORS[exception.code] ?? [500, 'Database error.'];
      this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
      res.status(status).json({ statusCode: status, message, code: exception.code });
      return;
    }
    if (exception instanceof Prisma.PrismaClientInitializationError) {
      this.logger.error(`Database unreachable: ${exception.message}`);
      res.status(503).json({ statusCode: 503, message: 'The database is not reachable. Check DATABASE_URL and that PostgreSQL is running.' });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
