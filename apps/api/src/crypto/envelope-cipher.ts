import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EnvelopeCipher, SealedSecret } from './secret-encryption.types';

const ALGO = 'AES-256-GCM';
const NODE_ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // AES-GCM nonce
const TAG_BYTES = 16;

/**
 * NodeEnvelopeCipher — AES-256-GCM via Node `crypto` (plan §6a). Pure AEAD: no KMS/DB knowledge.
 *
 * - seal: fresh 12-byte nonce per call (`crypto` randomBytes via createCipheriv requires explicit iv),
 *   binds `aad`, returns ciphertext + iv + 16-byte tag. The caller (SecretEncryptionService) supplies a
 *   fresh DEK per write — this class never reuses a (key, nonce) pair.
 * - open: verifies tag + aad; throws a GENERIC error on any mismatch (Node's GCM error carries no
 *   plaintext/key material). Wrong key length / tampered tag / wrong aad all surface as a throw.
 */
@Injectable()
export class NodeEnvelopeCipher implements EnvelopeCipher {
  seal(plaintext: string, dek: Buffer, aad: Buffer): SealedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(NODE_ALGO, dek, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { ciphertext, iv, authTag, algo: ALGO };
  }

  open(sealed: SealedSecret, dek: Buffer, aad: Buffer): string {
    const decipher = createDecipheriv(NODE_ALGO, dek, sealed.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.authTag);
    // .final() throws on auth/aad mismatch — Node's message is generic (no plaintext/key leak).
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
  }
}
