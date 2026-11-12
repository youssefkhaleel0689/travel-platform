import { JwtService } from '@nestjs/jwt';
import { jwtModuleOptions } from '../jwt-secret';
import { AccessTokenService } from './access-token.service';

// Test-only secrets of 32+ characters; never used outside this file.
const SECRET = 'test-secret-for-access-tokens-0123456789';
const OTHER_SECRET = 'another-test-secret-for-tokens-9876543210';
const USER_ID = '6720f1c2a1b2c3d4e5f60718';

// A real JwtService with the module's real settings.
const jwt = new JwtService(jwtModuleOptions(SECRET));
const service = new AccessTokenService(jwt);

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('AccessTokenService (ACC-04)', () => {
  it('signs a token whose payload holds the user id only', async () => {
    const token = await service.sign(USER_ID);
    const payload = jwt.decode<Record<string, unknown>>(token);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(payload.sub).toBe(USER_ID);
    expect(payload).not.toHaveProperty('role');
  });

  it('signs with HS256 and a 30-minute lifetime', async () => {
    const token = await service.sign(USER_ID);
    const decoded = jwt.decode<{ iat: number; exp: number }>(token, {
      complete: true,
    });
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.exp - decoded.payload.iat).toBe(30 * 60);
  });

  it('returns the user id for its own token', async () => {
    const token = await service.sign(USER_ID);
    await expect(service.verify(token)).resolves.toEqual({ userId: USER_ID });
  });

  it('rejects a token signed with another secret', async () => {
    const other = new JwtService(jwtModuleOptions(OTHER_SECRET));
    const token = await other.signAsync({ sub: USER_ID });
    await expect(service.verify(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await jwt.signAsync({ sub: USER_ID }, { expiresIn: -10 });
    await expect(service.verify(token)).resolves.toBeNull();
  });

  it("rejects an unsigned token with alg 'none'", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
      sub: USER_ID,
      iat: now,
      exp: now + 600,
    })}.`;
    await expect(service.verify(token)).resolves.toBeNull();
  });

  it('rejects a token signed with the same secret but HS512', async () => {
    const token = await jwt.signAsync({ sub: USER_ID }, { algorithm: 'HS512' });
    await expect(service.verify(token)).resolves.toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const [header, , signature] = (await service.sign(USER_ID)).split('.');
    const forged = base64url({
      sub: '000000000000000000000000',
      iat: Math.floor(Date.now() / 1000),
    });
    await expect(
      service.verify(`${header}.${forged}.${signature}`),
    ).resolves.toBeNull();
  });

  it.each(['', 'not-a-token', 'a.b.c', 'a.b'])(
    'rejects the malformed string %p',
    async (token) => {
      await expect(service.verify(token)).resolves.toBeNull();
    },
  );

  it.each([
    ['missing', {}],
    ['not a string', { sub: 42 }],
    ['not 24 hex characters', { sub: 'abc' }],
    ['24 characters that are not hex', { sub: 'zzzzzzzzzzzzzzzzzzzzzzzz' }],
  ])('rejects a sub that is %s', async (_label, payload) => {
    const token = await jwt.signAsync(payload);
    await expect(service.verify(token)).resolves.toBeNull();
  });
});
