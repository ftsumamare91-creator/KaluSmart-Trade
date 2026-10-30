import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';

/** Minimal fakes for the database, audit log and email sender. No real data is touched. */
function makeService(opts: { emailFails: boolean; existingUser?: unknown }) {
  const tx = {
    user: { create: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@example.com' }) },
    organization: { create: jest.fn().mockResolvedValue({ id: 'o1' }) },
    membership: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(opts.existingUser ?? null) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    authToken: { updateMany: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
  };
  const audit: any = { record: jest.fn().mockResolvedValue(undefined) };
  const email: any = {
    send: opts.emailFails
      ? jest.fn().mockRejectedValue(new Error('provider down'))
      : jest.fn().mockResolvedValue(undefined),
  };
  return { service: new AuthService(prisma, audit, email), prisma, tx };
}

const signup = { name: 'Abebe', email: 'a@example.com', password: 'abcdefghi1', organizationName: 'Kalu' };

describe('signup when the verification email cannot be sent', () => {
  beforeEach(() => { process.env.REQUIRE_EMAIL_VERIFICATION = 'true'; });
  afterEach(() => { delete process.env.REQUIRE_EMAIL_VERIFICATION; });

  it('still creates the account and asks the user to verify (no 500)', async () => {
    const { service, tx } = makeService({ emailFails: true });
    const result = await service.register(signup);
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(result.verificationRequired).toBe(true);
  });

  it('rejects a duplicate email with 409 and creates nothing', async () => {
    const { service, tx } = makeService({ emailFails: false, existingUser: { id: 'u0' } });
    await expect(service.register(signup)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});

describe('resend verification when the provider fails', () => {
  it('answers normally instead of throwing', async () => {
    const { service } = makeService({
      emailFails: true,
      existingUser: { id: 'u1', email: 'a@example.com', emailVerifiedAt: null },
    });
    await expect(service.resendVerification('a@example.com')).resolves.toBeUndefined();
  });

  it('stays silent for unknown emails (no account enumeration)', async () => {
    const { service, prisma } = makeService({ emailFails: false, existingUser: null });
    await expect(service.resendVerification('nobody@example.com')).resolves.toBeUndefined();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });
});
