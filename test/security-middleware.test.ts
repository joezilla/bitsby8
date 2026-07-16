/**
 * Tests for the API rate-limiter LAN exemption. This appliance trusts its own
 * LAN (auth still applies), so the general /api limiter must skip private and
 * loopback client addresses — otherwise an operator polling the Run cockpit
 * from 10.x/192.168.x eats spurious 429s ("too many requests"). Anything
 * routed/public must stay limited, so false positives are a security bug.
 */

import { isTrustedLanIp } from '../src/middleware/security';

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
