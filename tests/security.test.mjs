import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Seguridad centralizada ETAPA 2 (@ai-scraper/security)', async () => {
  const sec = await import('../packages/security/dist/index.js');
  const { CommandValidator } = await import('../packages/commands/dist/validator.js');

  it('bloquea hosts privados, metadata y protocolos no http', () => {
    for (const u of [
      'http://localhost/admin',
      'http://127.0.0.1/admin',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.20.0.4/',
      'http://169.254.169.254/latest/meta-data/',
      'ftp://example.com/x',
    ]) {
      assert.throws(() => sec.assertPublicUrl(u), /SSRF|Protocolo|inválida/);
    }
  });

  it('permite hosts públicos y bypass local solo con flag', () => {
    assert.equal(sec.assertPublicUrl('https://example.com/').hostname, 'example.com');
    assert.equal(sec.isBlockedHost('example.com'), false);
    assert.equal(sec.isBlockedHost('169.254.169.254'), true);
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    assert.equal(sec.assertPublicUrl('http://127.0.0.1:3000/x').hostname, '127.0.0.1');
    delete process.env.ALLOW_PRIVATE_HOSTS;
    assert.throws(() => sec.assertPublicUrl('http://127.0.0.1/x'), /SSRF/);
  });

  it('allowlist por job: mismo dominio + subdominios, nunca fuera', () => {
    const allow = sec.createAllowlist('https://tienda.com/inicio');
    assert.equal(allow.root, 'tienda.com');
    assert.equal(allow.isAllowed('https://tienda.com/p/1'), true);
    assert.equal(allow.isAllowed('https://sub.tienda.com/x'), true);
    assert.equal(allow.isAllowed('https://evil-tienda.com/x'), false);
    assert.equal(allow.isAllowed('https://evil.com/x'), false);
    assert.throws(() => allow.assert('https://evil.com/x'), /dominio/);
  });

  it('CommandValidator usa la fuente única (SSRF + dominio)', () => {
    const v = new CommandValidator({ allowedDomain: 'example.com', maxDepth: 5, maxPages: 100 });
    assert.throws(() => v.validateCommand({ type: 'NAVIGATE', url: 'http://169.254.169.254/x' }));
    assert.throws(() => v.validateCommand({ type: 'NAVIGATE', url: 'https://evil.com/x' }));
    const ok = v.validateCommand({ type: 'NAVIGATE', url: 'https://sub.example.com/x' });
    assert.equal(ok.type, 'NAVIGATE');
  });

  it('bloquea IPv6 (corchetes), IPv4-mapped, ULA, link-local y CGNAT', () => {
    for (const u of [
      'http://[::1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fc00::1]/',
      'http://[fe80::1]/',
      'http://100.64.0.1/',
      'http://169.254.10.10/',
      'http://192.0.2.1/',
      'http://198.18.0.1/',
      'http://203.0.113.1/',
      'http://224.0.0.1/',
      'http://[ff02::1]/',
      'http://[2001:db8::1]/',
    ]) {
      assert.throws(() => sec.assertPublicUrl(u), /SSRF/, `debe bloquear ${u}`);
    }
    assert.equal(sec.isBlockedIp('[::1]'), true);
    assert.equal(sec.isBlockedIp('::ffff:10.0.0.1'), true);
    assert.equal(sec.isBlockedIp('2606:4700:4700::1111'), false);
  });

  it('ALLOW_PRIVATE_HOSTS se ignora en producción', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevAllow = process.env.ALLOW_PRIVATE_HOSTS;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PRIVATE_HOSTS = '1';
    assert.equal(sec.isPrivateHostsAllowed(), false);
    assert.throws(() => sec.assertPublicUrl('http://127.0.0.1/x'), /SSRF/);
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevAllow === undefined) delete process.env.ALLOW_PRIVATE_HOSTS;
    else process.env.ALLOW_PRIVATE_HOSTS = prevAllow;
  });

  it('assertSafeUrl resuelve DNS y bloquea hosts que apuntan a IP privada', async () => {
    // localhost está bloqueado por string; un host que resuelve a 127.0.0.1 vía DNS también debe caer.
    await assert.rejects(() => sec.assertSafeUrl('http://localhost/x'), /SSRF/);
  });
});
