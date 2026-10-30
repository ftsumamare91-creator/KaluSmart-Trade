import { assertPasswordPolicy } from './auth.service';
import { appUrl, requireEmailVerification } from '../common/config';

describe('password policy', () => {
  it('rejects short passwords and passwords without digits or letters', () => {
    expect(() => assertPasswordPolicy('abc123')).toThrow();
    expect(() => assertPasswordPolicy('abcdefghijk')).toThrow();
    expect(() => assertPasswordPolicy('1234567890')).toThrow();
  });
  it('accepts a 10+ character password with letters and digits', () => {
    expect(() => assertPasswordPolicy('abcdefghi1')).not.toThrow();
  });
});

describe('verification and links', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('requires verification by default only in production', () => {
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    process.env.NODE_ENV = 'development';
    expect(requireEmailVerification()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(requireEmailVerification()).toBe(true);
  });
  it('builds links from the first web origin and strips trailing slashes', () => {
    delete process.env.APP_URL;
    process.env.WEB_ORIGIN = 'https://app.example.com/, http://localhost:3000';
    expect(appUrl()).toBe('https://app.example.com');
  });
});
