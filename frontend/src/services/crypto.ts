// 简单的 AES-GCM 对称加解密工具，用于封装 Seal 信封加密流程。

const AES_KEY_LENGTH = 32; // 256 bit
const IV_LENGTH = 12; // 96 bit

export async function generateAesKey(): Promise<{ cryptoKey: CryptoKey; rawKey: Uint8Array }> {
  const cryptoKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_LENGTH * 8 },
    true,
    ["encrypt", "decrypt"]
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", cryptoKey));
  return { cryptoKey, rawKey };
}

export async function encryptToBase64(plainText: string, cryptoKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plainText);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded)
  );
  // 拼接 iv + cipher
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return toBase64(combined);
}

export async function decryptFromBase64(cipherBase64: string, cryptoKey: CryptoKey): Promise<string> {
  const combined = fromBase64(cipherBase64);
  const iv = combined.slice(0, IV_LENGTH);
  const cipher = combined.slice(IV_LENGTH);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, cipher);
  return new TextDecoder().decode(plainBuf);
}

export function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
