/**
 * Self-contained RFC 4226 / RFC 6238 TOTP implementation (SHA-1, 30s step,
 * 6 digits — the WebUntis defaults). Pure JS, no native crypto module, so it
 * runs the same under Hermes as it does in Node.
 *
 * Used to turn the secret embedded in a WebUntis "share with other apps" QR
 * code into the same 6-digit code the official app would generate, so we can
 * log in as the real account without ever touching the user's password.
 */

/**
 * RFC 4648 base32 decode (the alphabet WebUntis secrets are encoded in).
 *
 * Throws on a character outside the alphabet rather than skipping it: silently
 * dropping one character shifts every bit after it, producing a secret that
 * looks fine and generates codes the server rejects as "bad credentials" —
 * with nothing to point at the cause.
 */
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // separators people paste in are fine; unknown letters are not
  const clean = input.toUpperCase().replace(/[\s-]+/g, '').replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Secret is not valid base32 (unexpected "${ch}")`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** Minimal pure-JS SHA-1 (Uint8Array in, 20-byte Uint8Array out). */
function sha1(data: Uint8Array): Uint8Array {
  const h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);

  const bitLen = data.length * 8;
  const withOne = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  withOne.set(data);
  withOne[data.length] = 0x80;
  const dv = new DataView(withOne.buffer);
  // high 32 bits of length are always 0 for anything we'll ever hash here
  dv.setUint32(withOne.length - 4, bitLen >>> 0, false);

  const w = new Int32Array(80);
  for (let chunk = 0; chunk < withOne.length; chunk += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(chunk + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (v << 1) | (v >>> 31);
    }
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
  }

  const out = new Uint8Array(20);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) outDv.setInt32(i * 4, h[i], false);
  return out;
}

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) k = sha1(k);
  if (k.length < blockSize) {
    const padded = new Uint8Array(blockSize);
    padded.set(k);
    k = padded;
  }
  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = k[i] ^ 0x5c;
    iKeyPad[i] = k[i] ^ 0x36;
  }
  const inner = sha1(concat(iKeyPad, message));
  return sha1(concat(oKeyPad, inner));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Generates the current 6-digit TOTP code for a base32 secret, RFC-6238
 * style (30 second step, SHA-1, dynamic truncation).
 */
export function totp(secretBase32: string, timestampMs: number = Date.now()): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / 30);

  const counterBytes = new Uint8Array(8);
  const dv = new DataView(counterBytes.buffer);
  // counter fits in the low 32 bits for any date we care about
  dv.setUint32(4, counter >>> 0, false);

  const digest = hmacSha1(key, counterBytes);
  const offset = digest[digest.length - 1] & 0x0f;
  const binCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const code = String(binCode % 1_000_000).padStart(6, '0');
  return code;
}
