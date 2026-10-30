import { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function fakeHost() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  it('maps a Prisma validation error to 400 and hides the query details', () => {
    const { host, res } = fakeHost();
    const err = new Prisma.PrismaClientValidationError('Invalid `take` value: secret-user-input', { clientVersion: '6.19.3' });
    new AllExceptionsFilter().catch(err, host);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('secret-user-input');
  });

  it('returns a generic 500 for unexpected errors', () => {
    const { host, res } = fakeHost();
    new AllExceptionsFilter().catch(new Error('boom: internal detail'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });
});
