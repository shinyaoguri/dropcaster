/**
 * ランダムな UUID v4 を返す。
 *
 * Crypto の randomUUID は secure context (HTTPS / localhost) 限定で、`dropcaster dev --host` /
 * `preview --host` が案内する LAN の `http://<IP>:<port>` では未定義になる (#170)。
 * getRandomValues はどの context でも使えるので、こちらから RFC 4122 の v4 を組み立てる。
 * viewer の ID はすべてここを通す (tests/random-id.test.js が直接呼び出しを検出する)。
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
