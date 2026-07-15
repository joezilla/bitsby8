/**
 * Route tests for /api/scripts — the page had a flaky upload (a field-name
 * mismatch surfaced as a 500) and extension-based binary detection that wrongly
 * flagged text scripts (hello.bas) as binary. These lock the fixed behavior:
 * content-based binary detection, and uploads that fail cleanly (400/413), not 500.
 */

import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { registerScriptRoutes } from '../src/routes/scripts';

async function buildApp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-rs-'));
  const scriptsDir = path.join(dir, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  const deps: any = { config: { scriptsDir } };
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerScriptRoutes(router, deps);
  app.use(router);
  return { app, dir, scriptsDir };
}

// A .bas source with CR line endings — control bytes (0x0D) but no NUL, so text.
const BAS = '10 PRINT "HI"\r20 GOTO 10\r';

describe('routes: /api/scripts', () => {
  test('create + list + get a text script (round-trips content)', async () => {
    const { app } = await buildApp();
    await request(app).post('/api/scripts').send({ name: 'hello.bas', content: BAS }).expect(200);

    const list = await request(app).get('/api/scripts').expect(200);
    expect(list.body.scripts.map((s: { name: string }) => s.name)).toContain('hello.bas');

    const got = await request(app).get('/api/scripts/hello.bas').expect(200);
    expect(got.body).toMatchObject({ name: 'hello.bas', binary: false, content: BAS });
  });

  test('binary is detected by content (NUL byte), not the extension', async () => {
    const { app, scriptsDir } = await buildApp();
    // hello.bas has CR control bytes but no NUL — text (the old .txt-only rule flagged it binary).
    await request(app).post('/api/scripts').send({ name: 'hello.bas', content: BAS }).expect(200);
    expect((await request(app).get('/api/scripts/hello.bas').expect(200)).body.binary).toBe(false);

    // A real NUL byte on disk is binary — content withheld, even with a .txt name.
    await fs.writeFile(path.join(scriptsDir, 'blob.txt'), Buffer.from([0x41, 0x00, 0x42]));
    const blob = await request(app).get('/api/scripts/blob.txt').expect(200);
    expect(blob.body.binary).toBe(true);
    expect(blob.body.content).toBeUndefined();
  });

  test('upload succeeds with the `file` field', async () => {
    const { app, scriptsDir } = await buildApp();
    const res = await request(app)
      .post('/api/scripts/upload')
      .attach('file', Buffer.from(BAS), 'session.bas')
      .expect(200);
    expect(res.body).toMatchObject({ success: true, name: 'session.bas' });
    expect(await fs.readFile(path.join(scriptsDir, 'session.bas'), 'utf-8')).toBe(BAS);
  });

  test('upload under the wrong field fails cleanly (400, not 500) — the reported bug', async () => {
    const { app } = await buildApp();
    const res = await request(app)
      .post('/api/scripts/upload')
      .attach('script', Buffer.from('x'), 'x.txt'); // wrong field name
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('upload with no file → 400', async () => {
    const { app } = await buildApp();
    await request(app).post('/api/scripts/upload').expect(400);
  });

  test('get a missing script → 404; delete removes it', async () => {
    const { app } = await buildApp();
    await request(app).get('/api/scripts/nope.txt').expect(404);
    await request(app).post('/api/scripts').send({ name: 'tmp.txt', content: 'x' }).expect(200);
    await request(app).delete('/api/scripts/tmp.txt').expect(200);
    await request(app).get('/api/scripts/tmp.txt').expect(404);
  });
});
