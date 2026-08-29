/**
 * freeChat: Native Web Crypto API & Zero-Knowledge Cryptography Engine
 * - Algorithm: ECDH (P-256) for shared key exchange
 * - Algorithm: AES-256-GCM for message & payload encryption
 * - Algorithm: PBKDF2 (100,000 iterations, SHA-256) for password key derivation
 * - Storage: Browser IndexedDB for non-volatile key persistence
 */

// Memory cache for derived 1-on-1 shared keys (targetUserId -> CryptoKey)
const sharedKeyCache = new Map();

// Helper: ArrayBuffer <-> Base64 conversion
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper: Generate Cryptographically Secure Random Salt & IV
export function generateRandomBytes(length = 16) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 1. Key Pair Generation (ECDH P-256)
 */
export async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true, // Extractable so we can backup and cache
    ['deriveKey', 'deriveBits']
  );
  return keyPair;
}

export async function exportPublicKey(publicKey) {
  const exported = await window.crypto.subtle.exportKey('jwk', publicKey);
  return JSON.stringify(exported);
}

export async function importPublicKey(jwkString) {
  const jwk = typeof jwkString === 'string' ? JSON.parse(jwkString) : jwkString;
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    []
  );
}

export async function exportPrivateKey(privateKey) {
  const exported = await window.crypto.subtle.exportKey('jwk', privateKey);
  return JSON.stringify(exported);
}

export async function importPrivateKey(jwkString) {
  const jwk = typeof jwkString === 'string' ? JSON.parse(jwkString) : jwkString;
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * 2. Password-based Key Derivation (PBKDF2)
 */
export async function deriveMasterKey(password, saltBuffer) {
  const enc = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey', 'deriveBits']
  );

  const masterKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  return masterKey;
}

export async function deriveAuthVerifier(password, saltBase64) {
  const enc = new TextEncoder();
  const data = enc.encode(`${password}:${saltBase64}`);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hashBuffer);
}

/**
 * 3. Encrypted Private Key Cloud Backup
 */
export async function encryptPrivateKeyBackup(privateKey, masterKey) {
  const privateKeyJwk = await exportPrivateKey(privateKey);
  const enc = new TextEncoder();
  const encoded = enc.encode(privateKeyJwk);
  const iv = generateRandomBytes(12);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    encoded
  );

  return {
    encryptedPrivateKey: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv)
  };
}

export async function decryptPrivateKeyBackup(encryptedBase64, ivBase64, masterKey) {
  const encryptedBuffer = base64ToArrayBuffer(encryptedBase64);
  const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    encryptedBuffer
  );

  const dec = new TextDecoder();
  const jwkString = dec.decode(decryptedBuffer);
  return await importPrivateKey(jwkString);
}

/**
 * 4. 1-on-1 Shared Secret Derivation (ECDH)
 */
export async function getSharedSecretKey(localPrivateKey, remotePublicKeyJwk, cacheId = null) {
  if (cacheId && sharedKeyCache.has(cacheId)) {
    return sharedKeyCache.get(cacheId);
  }

  const remotePublicKey = await importPublicKey(remotePublicKeyJwk);

  const sharedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: remotePublicKey
    },
    localPrivateKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );

  if (cacheId) {
    sharedKeyCache.set(cacheId, sharedKey);
  }

  return sharedKey;
}

/**
 * 5. Message Encryption & Decryption (AES-256-GCM)
 */
export async function encryptMessage(plainText, sharedKey) {
  const enc = new TextEncoder();
  const encoded = enc.encode(plainText);
  const iv = generateRandomBytes(12);

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv)
  };
}

export async function decryptMessage(ciphertextBase64, ivBase64, sharedKey) {
  try {
    const ciphertextBuffer = base64ToArrayBuffer(ciphertextBase64);
    const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      ciphertextBuffer
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  } catch (err) {
    console.error('[Crypto Decryption Failed]:', err);
    return '🔒 [Unable to decrypt message]';
  }
}

/**
 * 6. Local IndexedDB Key Store for Instant Session Persistence
 */
const DB_NAME = 'freeChat_CryptoVault';
const STORE_NAME = 'keys';

function openKeyDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const KeyStore = {
  async saveUserKeys(userId, privateKey, publicKey) {
    const db = await openKeyDatabase();
    const privJwk = await exportPrivateKey(privateKey);
    const pubJwk = await exportPublicKey(publicKey);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        userId,
        privateKeyJwk: privJwk,
        publicKeyJwk: pubJwk,
        updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getUserKeys(userId) {
    const db = await openKeyDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(userId);
      req.onsuccess = async () => {
        if (!req.result) return resolve(null);
        try {
          const privateKey = await importPrivateKey(req.result.privateKeyJwk);
          const publicKey = await importPublicKey(req.result.publicKeyJwk);
          resolve({ privateKey, publicKey, publicKeyJwk: req.result.publicKeyJwk });
        } catch (e) {
          reject(e);
        }
      };
      req.onerror = () => reject(req.error);
    });
  },

  async clearUserKeys(userId) {
    const db = await openKeyDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(userId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
};

