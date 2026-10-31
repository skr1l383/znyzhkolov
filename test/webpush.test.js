// Шифрування пуш-сповіщень: точний приклад зі стандарту RFC 8291 (розділ 5) і підпис VAPID (RFC 8292).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { allowedEndpoint, encryptPayload, vapidAuthorization } from '../server/services/webpush.js';

test('Web Push: шифрування збігається з прикладом зі стандарту RFC 8291', () => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  const body = encryptPayload(
    'When I grow up, I want to be a watermelon',
    {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    },
    { salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'), ecdh }
  );
  assert.equal(
    body.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  );
});

test('Web Push: підпис VAPID перевіряється публічним ключем сайту', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { privateKey, publicKey: raw });
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, raw);
  const [h, c, s] = token.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.ok(claims.exp > Date.now() / 1000);
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('Web Push: надсилаємо лише на справжні сервіси сповіщень (захист від SSRF)', () => {
  assert.equal(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  assert.equal(allowedEndpoint('https://web.push.apple.com/QF2x'), true);
  assert.equal(allowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'), true);
  assert.equal(allowedEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false, 'лише https');
  assert.equal(allowedEndpoint('https://127.0.0.1:3000/api/admin'), false);
  assert.equal(allowedEndpoint('https://evil-fcm.googleapis.com.attacker.io/x'), false);
  assert.equal(allowedEndpoint('not a url'), false);
});
