/**
 * Integration tests for src/routes/auth.ts.
 *
 * Exercises the login → session-cookie → protected-endpoint round-trip
 * plus the change-password flow. Uses a real Express router, a real
 * SessionStore, and a real bcrypt hash — no mocks. supertest drives
 * the requests.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { registerAuthRoutes, SESSION_COOKIE_NAME } from '../src/routes/auth';
import { SessionStore } from '../src/services/session-store';
import { hashPassword } from '../src/services/password';

async function makeTempOverride(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-auth-'));
  const file = path.join(dir, 'fdcsds.overrides.json');
  await fs.writeFile(file, '{}');
  return file;
}

async function buildApp(overrides: Partial<any> = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const sessionStore = new SessionStore();
  const overrideConfigFilePath = await makeTempOverride();
  const passwordHash = await hashPassword('the-current-password');

  const deps: any = {
    runtimeConfig: { adminPassword: passwordHash, apiKey: null },
    sessionStore,
    overrideConfigFilePath,
    baselineConfig: null,
    ...overrides,
  };

  const router = express.Router();
  registerAuthRoutes(router, deps);
  app.use(router);
  return { app, deps, sessionStore };
}

describe('POST /api/auth/login', () => {
  test('rejects an empty body with 400', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 with LOGIN_NOT_CONFIGURED when no adminPassword is set', async () => {
    const { app } = await buildApp({ runtimeConfig: { adminPassword: null } });
    const res = await request(app).post('/api/auth/login').send({ password: 'anything' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOGIN_NOT_CONFIGURED');
  });

  test('returns 401 for the wrong password', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/auth/login').send({ password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('returns 200 and sets a session cookie for the correct password', async () => {
    const { app, sessionStore } = await buildApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'the-current-password' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Set-Cookie: fdcSession=<id>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies?.length).toBeGreaterThan(0);
    const cookie = cookies![0];
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=2592000');
    expect(sessionStore.size()).toBe(1);
  });
});

describe('POST /api/auth/logout', () => {
  test('destroys the current session and clears the cookie', async () => {
    const { app, sessionStore } = await buildApp();

    // Log in to get a cookie.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ password: 'the-current-password' });
    const setCookie = (login.headers['set-cookie'] as unknown as string[])[0];
    const sessionId = setCookie.split(';')[0].split('=')[1];
    expect(sessionStore.size()).toBe(1);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${sessionId}`);
    expect(logout.status).toBe(200);
    expect(sessionStore.size()).toBe(0);
    const clearCookie = (logout.headers['set-cookie'] as unknown as string[])[0];
    expect(clearCookie).toContain('Max-Age=0');
  });

  test('is idempotent — 200 even without a session cookie', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/change-password', () => {
  test('requires the old password even when authenticated', async () => {
    const { app } = await buildApp();
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ oldPassword: 'wrong', newPassword: 'brand-new' });
    expect(res.status).toBe(401);
  });

  test('rejects empty body with 400', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/auth/change-password').send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 LOGIN_NOT_CONFIGURED when there is no current password', async () => {
    const { app } = await buildApp({ runtimeConfig: { adminPassword: null } });
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ oldPassword: 'any', newPassword: 'new' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOGIN_NOT_CONFIGURED');
  });

  test('rotates the password, writes the new hash, and destroys other sessions but not the caller', async () => {
    const { app, deps, sessionStore } = await buildApp();

    // Two sessions: caller (with cookie) and another browser (no cookie).
    const login = await request(app)
      .post('/api/auth/login')
      .send({ password: 'the-current-password' });
    const callerCookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const callerSessionId = callerCookie.split('=')[1];
    sessionStore.createSession(); // simulate another browser
    expect(sessionStore.size()).toBe(2);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', callerCookie)
      .send({ oldPassword: 'the-current-password', newPassword: 'brand-new' });
    expect(res.status).toBe(200);

    // Caller kept, other kicked.
    expect(sessionStore.size()).toBe(1);
    expect(sessionStore.validateSession(callerSessionId)).toBe(true);

    // Runtime and override are both updated with a new bcrypt hash.
    expect(deps.runtimeConfig.adminPassword).not.toBe(await hashPassword('the-current-password'));
    const onDisk = JSON.parse(await fs.readFile(deps.overrideConfigFilePath, 'utf-8'));
    expect(typeof onDisk.adminPassword).toBe('string');
    expect(onDisk.adminPassword.startsWith('$2')).toBe(true);
  });
});
