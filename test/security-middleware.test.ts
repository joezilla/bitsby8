/**
 * Tests for the API rate-limiter LAN exemption. This appliance trusts its own
 * LAN (auth still applies), so the general /api limiter must skip private and
 * loopback client addresses — otherwise an operator polling the Run cockpit
 * from 10.x/192.168.x eats spurious 429s ("too many requests"). Anything
 * routed/public must stay limited, so false positives are a security bug.
 */

import * as os from 'os';
import { isAllowedOrigin, isTrustedLanIp } from '../src/middleware/security';
import { WebServerConfig } from '../src/types';

describe('isTrustedLanIp', () => {
  it('trusts IPv4 loopback and private ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '127.5.5.5',
      '10.1.1.94',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.10',
      '169.254.1.1', // link-local
    ]) {
      expect(isTrustedLanIp(ip)).toBe(true);
    }
  });

  it('trusts IPv6 loopback and unique/link-local', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1']) {
      expect(isTrustedLanIp(ip)).toBe(true);
    }
  });

  it('trusts IPv4-mapped IPv6 by its embedded v4', () => {
    expect(isTrustedLanIp('::ffff:10.1.1.94')).toBe(true);
    expect(isTrustedLanIp('::ffff:192.168.1.5')).toBe(true);
    expect(isTrustedLanIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('rate-limits routed/public addresses', () => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1', // just outside 172.16/12
      '172.32.0.1', // just outside 172.16/12
      '192.169.0.1', // not 192.168/16
      '169.253.0.1', // not link-local
      '2001:4860:4860::8888', // public IPv6
    ]) {
      expect(isTrustedLanIp(ip)).toBe(false);
    }
  });

  it('does not trust an undefined or malformed address', () => {
    expect(isTrustedLanIp(undefined)).toBe(false);
    expect(isTrustedLanIp('')).toBe(false);
    expect(isTrustedLanIp('not.an.ip.addr')).toBe(false);
    expect(isTrustedLanIp('10.1.1')).toBe(false);
    expect(isTrustedLanIp('999.1.1.1')).toBe(false);
  });
});

/**
 * The CORS gate is evaluated per request (isAllowedOrigin), NOT from a list
 * snapshotted at startup. This is the regression that left the operator's
 * `http://<lan-ip>:3000` rejected when the daemon booted (on WiFi, network.target
 * only) a moment before wlan0 got its DHCP address: the frozen origin set never
 * contained the LAN IP. Evaluating live also survives a DHCP renewal.
 */
describe('isAllowedOrigin', () => {
  const config = { host: '0.0.0.0', port: 3000 } as WebServerConfig;

  it('allows a missing origin (same-origin nav, curl/MCP)', () => {
    expect(isAllowedOrigin(undefined, config)).toBe(true);
    expect(isAllowedOrigin('', config)).toBe(true);
  });

  it('allows any loopback/private LAN IP on the web port — regardless of boot-time interfaces', () => {
    for (const origin of [
      'http://10.1.1.94:3000',
      'http://192.168.1.50:3000',
      'http://172.16.9.9:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://[::1]:3000',
      'http://[fd12:3456::1]:3000',
    ]) {
      expect(isAllowedOrigin(origin, config)).toBe(true);
    }
  });

  it('allows the machine hostname and its .local alias', () => {
    const machine = os.hostname();
    expect(isAllowedOrigin(`http://${machine}:3000`, config)).toBe(true);
    expect(isAllowedOrigin(`http://${machine}.local:3000`, config)).toBe(true);
  });

  it('rejects a matching host on the wrong port', () => {
    expect(isAllowedOrigin('http://10.1.1.94:8080', config)).toBe(false);
    expect(isAllowedOrigin('http://localhost:3001', config)).toBe(false);
  });

  it('rejects routed/public origins and non-http schemes', () => {
    expect(isAllowedOrigin('http://8.8.8.8:3000', config)).toBe(false);
    expect(isAllowedOrigin('http://evil.example.com:3000', config)).toBe(false);
    expect(isAllowedOrigin('file:///etc/passwd', config)).toBe(false);
    expect(isAllowedOrigin('not a url', config)).toBe(false);
  });

  it('honors the scheme default port when the origin omits it', () => {
    expect(isAllowedOrigin('http://10.1.1.94', { host: '0.0.0.0', port: 80 } as WebServerConfig)).toBe(
      true,
    );
    expect(isAllowedOrigin('http://10.1.1.94', config)).toBe(false); // default 80 != 3000
  });
});
