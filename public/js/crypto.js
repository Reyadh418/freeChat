// Key cache
const sharedKeyCache = new Map();

// Base64 helpers
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

// Random bytes
export function generateRandomBytes(length = 16) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

// Key generation
export async function generateKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey', 'deriveBits']
  );
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

// Password derivation
export async function deriveMasterKey(password, saltBuffer) {
  const enc = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey', 'deriveBits']
  );

  return await window.crypto.subtle.deriveKey(
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
}

export async function deriveAuthVerifier(password, saltBase64, version = 2) {
  const enc = new TextEncoder();

  if (version === 1) {
    // Legacy single-round SHA-256 fallback for pre-existing accounts
    const data = enc.encode(`${password}:${saltBase64}`);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return arrayBufferToBase64(hashBuffer);
  }

  // v2 Hardened: PBKDF2 (100,000 iterations, SHA-256) with domain-separated salt (:auth)
  const saltBuffer = typeof saltBase64 === 'string' ? base64ToArrayBuffer(saltBase64) : saltBase64;
  const authSalt = new Uint8Array(saltBuffer.byteLength + 5);
  authSalt.set(new Uint8Array(saltBuffer), 0);
  authSalt.set(enc.encode(':auth'), saltBuffer.byteLength);

  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: authSalt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    256 // 256 bits = 32 bytes
  );

  return arrayBufferToBase64(derivedBits);
}

// Key backup
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

export function clearSharedKeyCache() {
  sharedKeyCache.clear();
}

// Key exchange
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

// Message encryption
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

// Key store
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

// Canonical serialization of ECDH public key JWK
export function canonicalJwkString(jwk) {
  const obj = typeof jwk === 'string' ? JSON.parse(jwk) : jwk;
  return JSON.stringify({
    crv: obj.crv,
    kty: obj.kty,
    x: obj.x,
    y: obj.y
  });
}

/**
 * Computes a deterministic, symmetric safety number and fingerprint between two public keys.
 * Sorts the two keys canonically so both parties compute the exact same 60-digit number.
 */
export async function computeSafetyNumber(localPublicKeyJwk, remotePublicKeyJwk) {
  const normA = canonicalJwkString(localPublicKeyJwk);
  const normB = canonicalJwkString(remotePublicKeyJwk);

  // Sort canonically so order of local/remote is symmetric on both ends
  const sorted = [normA, normB].sort();
  const enc = new TextEncoder();
  const combined = enc.encode(`${sorted[0]}|${sorted[1]}`);

  // SHA-512 provides 64 bytes of entropy for 60 decimal digits
  const cryptoSubtle = (typeof window !== 'undefined' && window.crypto?.subtle) || globalThis.crypto?.subtle;
  const digestBuffer = await cryptoSubtle.digest('SHA-512', combined);
  const bytes = new Uint8Array(digestBuffer);

  // 12 blocks of 5 digits = 60 digits total (Signal / WhatsApp standard format)
  const blocks = [];
  for (let i = 0; i < 12; i++) {
    const offset = i * 4;
    const val = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const block = (val % 100000).toString().padStart(5, '0');
    blocks.push(block);
  }

  // Also derive a short 16-character hex fingerprint (XXXX-XXXX-XXXX-XXXX)
  const shortDigest = await cryptoSubtle.digest('SHA-256', combined);
  const shortBytes = new Uint8Array(shortDigest).subarray(0, 8);
  let hex = '';
  for (const b of shortBytes) {
    hex += b.toString(16).padStart(2, '0').toUpperCase();
  }
  const fingerprint = hex.match(/.{1,4}/g).join('-');

  return {
    safetyNumber: blocks.join(' '),
    blocks,
    fingerprint
  };
}

// Verification storage helpers
export const VerifiedKeys = {
  _getStorage() {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (!this._mockStorage) {
      this._mockStorage = {
        _data: {},
        getItem(k) { return this._data[k] || null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; }
      };
    }
    return this._mockStorage;
  },

  _getKey(currentUserId) {
    return `freeChat_verified_keys_${currentUserId}`;
  },

  getAll(currentUserId) {
    if (!currentUserId) return {};
    try {
      return JSON.parse(this._getStorage().getItem(this._getKey(currentUserId)) || '{}');
    } catch {
      return {};
    }
  },

  get(currentUserId, contactId) {
    const all = this.getAll(currentUserId);
    return all[contactId] || null;
  },

  set(currentUserId, contactId, fingerprint, verified = true) {
    const all = this.getAll(currentUserId);
    all[contactId] = {
      fingerprint,
      verified,
      updatedAt: Date.now()
    };
    this._getStorage().setItem(this._getKey(currentUserId), JSON.stringify(all));
  },

  remove(currentUserId, contactId) {
    const all = this.getAll(currentUserId);
    delete all[contactId];
    this._getStorage().setItem(this._getKey(currentUserId), JSON.stringify(all));
  }
};

