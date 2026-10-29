// IP відвідувача за HTTPS-проксі: від нього залежать блокування спроб входу й захист від флуду.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { clientIp } from '../server/http.js';

const req = (remoteAddress, forwarded) => ({ socket: { remoteAddress }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} });

test('IP: X-Forwarded-For враховується лише від власного проксі й лише з TRUST_PROXY', () => {
  const before = config.trustProxy;
  try {
    config.trustProxy = false;
    assert.equal(clientIp(req('127.0.0.1', '203.0.113.7')), '127.0.0.1', 'без TRUST_PROXY заголовку не віримо');
    config.trustProxy = true;
    assert.equal(clientIp(req('127.0.0.1', '203.0.113.7, 10.0.0.1')), '203.0.113.7', 'за проксі — справжній IP відвідувача');
    assert.equal(clientIp(req('::ffff:127.0.0.1', '198.51.100.2')), '198.51.100.2');
    assert.equal(clientIp(req('198.51.100.9', '1.2.3.4')), '198.51.100.9', 'напряму з інтернету підробити IP не можна');
    assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1');
  } finally {
    config.trustProxy = before;
  }
});
