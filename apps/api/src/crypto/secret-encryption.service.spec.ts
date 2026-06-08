/**
 * G6-2b RED suite — SecretEncryptionService / NodeEnvelopeCipher unit tests.
 *
 * RED sources (why each case fails until 2c is implemented):
 *   RED 8  — NodeEnvelopeCipher.open() throws NOT_IMPLEMENTED:2c (not because of auth-tag/AAD logic).
 *   RED 9  — SecretEncryptionService.encryptSecret() throws NOT_IMPLEMENTED:2c (per-write DEK/nonce).
 *   RED 10 — SecretEncryptionService.encryptSecret/decryptSecret throw before logger can be called with
 *            any arguments, so logger-spy assertions on "no plaintext in logs" are vacuously safe; the
 *            real RED is that encryptSecret/decryptSecret throw NOT_IMPLEMENTED.
 *
 * Do NOT implement crypto logic here. These tests encode the FROZEN behavioral contract that 2c must satisfy.
 */

import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeEnvelopeCipher } from './envelope-cipher';
import { SecretEncryptionService, buildAad } from './secret-encryption.service';
import type {
  EncryptCtx,
  EncryptedColumns,
  EnvelopeCipher,
  KmsProvider,
  SealedSecret,
  WrappedDek,
} from './secret-encryption.types';

// ─── Seam constants ──────────────────────────────────────────────────────────

const COMPANY_ID = 'aabbccdd-0000-0000-0000-000000000001';
const RECORD_ID  = 'aabbccdd-0000-0000-0000-000000000002';
const PLAINTEXT  = 's3cr3t-p@ssw0rd!';

const ctx: EncryptCtx = {
  companyId: COMPANY_ID,
  recordId: RECORD_ID,
  purpose: 'platform_account',
};

// ─── Stub cipher / KMS for service-level tests ───────────────────────────────

function makeStubCipher(): EnvelopeCipher {
  return {
    seal: vi.fn((_plaintext: string, dek: Buffer, _aad: Buffer): SealedSecret => ({
      ciphertext: Buffer.from('ct-' + dek.toString('hex').slice(0, 4)),
      iv: Buffer.alloc(12, 0xab),
      authTag: Buffer.alloc(16, 0xcd),
      algo: 'AES-256-GCM',
    })),
    open: vi.fn((_sealed: SealedSecret, _dek: Buffer, _aad: Buffer): string => PLAINTEXT),
  };
}

function makeStubKms(): KmsProvider {
  return {
    wrapDek: vi.fn(async (dek: Buffer): Promise<WrappedDek> => ({
      wrapped: Buffer.concat([Buffer.from('wrapped:'), dek]),
      kmsKeyId: 'local-dev-kek',
      keyVersion: 1,
    })),
    unwrapDek: vi.fn(async (wrapped: Buffer): Promise<Buffer> =>
      wrapped.subarray('wrapped:'.length),
    ),
    currentKey: vi.fn(async () => ({ kmsKeyId: 'local-dev-kek', keyVersion: 1 })),
    // Rotation-only path — never exercised by SecretEncryptionService; present to satisfy the interface.
    reWrapDek: vi.fn(async (dek: Buffer): Promise<Buffer> =>
      Buffer.concat([Buffer.from('rewrapped:'), dek]),
    ),
  };
}

// ─── RED 8 — tamper / wrong authTag / wrong AAD → generic throw (no plaintext) ─
//
// TIGHTENED (no vacuous passes): every RED 8 case FAILS today and becomes a real AEAD security
// assertion post-2c. The cipher-unit cases force-RED via `sealOrFailRed`; the service cases force-RED
// via `encryptOrFailRed`. Both use the REAL NodeEnvelopeCipher so post-2c they exercise real AEAD +
// AAD binding (the actual security property), not a mocked seal/open.

describe('RED 8 — NodeEnvelopeCipher seal+open round-trip + tamper/wrong-AAD (cipher unit)', () => {
  const cipher = new NodeEnvelopeCipher();
  const dek = Buffer.alloc(32, 0x42);
  const aad = Buffer.from(COMPANY_ID + RECORD_ID + 'AES-256-GCM' + '1');

  /** Seal, or FORCE-RED if seal is unimplemented — so RED 8 is red NOW, never vacuously green. */
  function sealOrFailRed(): SealedSecret {
    try {
      return cipher.seal(PLAINTEXT, dek, aad);
    } catch (err) {
      // Correct NOT_IMPLEMENTED throw (not a setup error) — but force RED: the AEAD invariant
      // cannot be verified while seal is unimplemented (2c).
      expect('NodeEnvelopeCipher.seal unimplemented (2c)').toBe('seal implemented — AEAD invariant verifiable');
      throw err; // unreachable (expect above threw) — satisfies the return type
    }
  }

  it('RED 8a — seal+open round-trip with CORRECT data returns original plaintext', () => {
    const sealed = sealOrFailRed();
    expect(cipher.open(sealed, dek, aad)).toBe(PLAINTEXT);
  });

  it('RED 8b — wrong authTag → throws generic error with no plaintext/DEK leak', () => {
    const sealed = sealOrFailRed();
    const tampered = { ...sealed, authTag: Buffer.alloc(16, 0x00) };
    let threw = false;
    let errorMessage = '';
    try {
      cipher.open(tampered, dek, aad);
    } catch (err) {
      threw = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    expect(threw).toBe(true);
    expect(errorMessage).not.toContain(PLAINTEXT);
    expect(errorMessage).not.toContain(dek.toString('hex'));
  });

  it('RED 8c — wrong AAD (companyId/recordId swapped) → throws (CARRY-FORWARD 🔴 AAD bind)', () => {
    // AAD = utf8(companyId)‖utf8(recordId)‖utf8(encAlgo)‖utf8(dekKeyVersion). Swap → tag mismatch.
    const sealed = sealOrFailRed();
    const wrongAad = Buffer.from(RECORD_ID + COMPANY_ID + 'AES-256-GCM' + '1'); // swapped
    expect(() => cipher.open(sealed, dek, wrongAad)).toThrow();
  });

  it('RED 8d — open with empty DEK → throws (key length invalid)', () => {
    const sealed = sealOrFailRed();
    expect(() => cipher.open(sealed, Buffer.alloc(0), aad)).toThrow();
  });
});

describe('RED 8 (service) — encryptSecret→decryptSecret round-trip + tamper binds real AAD', () => {
  // Real cipher + faithful test KMS (wrap/unwrap the DEK identically). Post-2c these exercise REAL AEAD
  // and the CARRY-FORWARD 🔴 AAD binding via the service path, not a mocked seal/open. RED NOW because
  // encryptSecret throws NOT_IMPLEMENTED:2c.
  let svc: SecretEncryptionService;

  beforeEach(() => {
    svc = new SecretEncryptionService(new NodeEnvelopeCipher() as never, makeStubKms() as never);
  });

  /** Encrypt, or FORCE-RED if encryptSecret is unimplemented. */
  async function encryptOrFailRed(plaintext: string, c: EncryptCtx): Promise<EncryptedColumns> {
    try {
      return await svc.encryptSecret(plaintext, c);
    } catch (err) {
      expect('SecretEncryptionService.encryptSecret unimplemented (2c)').toBe(
        'encryptSecret implemented — round-trip verifiable',
      );
      throw err; // unreachable
    }
  }

  it('RED 8e — encrypt then decrypt with same ctx returns the original plaintext', async () => {
    const cols = await encryptOrFailRed(PLAINTEXT, ctx);
    expect(await svc.decryptSecret(cols, ctx)).toBe(PLAINTEXT);
  });

  it('RED 8f — tampered secret_ciphertext → decrypt throws generic, no plaintext leak', async () => {
    const cols = await encryptOrFailRed(PLAINTEXT, ctx);
    const tampered: EncryptedColumns = { ...cols, secretCiphertext: Buffer.from(cols.secretCiphertext) };
    tampered.secretCiphertext[0] ^= 0xff; // flip a byte → AEAD tag mismatch
    let threw = false;
    let msg = '';
    try {
      await svc.decryptSecret(tampered, ctx);
    } catch (err) {
      threw = true;
      msg = err instanceof Error ? err.message : String(err);
    }
    expect(threw).toBe(true);
    expect(msg).not.toContain(PLAINTEXT);
  });

  it('RED 8g — decrypt with swapped companyId in ctx → AAD mismatch throws (CARRY-FORWARD 🔴)', async () => {
    const cols = await encryptOrFailRed(PLAINTEXT, ctx);
    const wrongCtx: EncryptCtx = { ...ctx, companyId: 'ffffffff-0000-0000-0000-000000000009' };
    let threw = false;
    try {
      await svc.decryptSecret(cols, wrongCtx);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ─── RED 9 — per-write DEK+nonce uniqueness ───────────────────────────────────

describe('RED 9 — SecretEncryptionService.encryptSecret: per-write DEK+nonce uniqueness', () => {
  // Seam: encryptSecret throws NOT_IMPLEMENTED:2c.
  // When 2c is implemented: every call generates a fresh 32-byte DEK + 12-byte nonce via
  // crypto.randomBytes, so two calls on identical input MUST yield different ciphertext bytes.

  let svc: SecretEncryptionService;

  beforeEach(() => {
    // Use the REAL cipher (random 12-byte nonce per seal) + faithful test KMS so the per-write
    // nonce-uniqueness assertion (9b) is meaningful — a stub with a constant iv could never verify it.
    const cipher = new NodeEnvelopeCipher();
    const kms = makeStubKms();
    svc = new SecretEncryptionService(cipher as never, kms as never);
  });

  it('RED 9a — encryptSecret must resolve with EncryptedColumns (primary RED: currently throws NOT_IMPLEMENTED)', async () => {
    // RED: encryptSecret throws synchronously instead of resolving. The assertion below
    // will fail because the promise rejects (or sync-throws) instead of resolving.
    // Post-2c: resolves with EncryptedColumns → assertion passes.
    let result: EncryptedColumns | undefined;
    let err: unknown;
    try { result = await svc.encryptSecret(PLAINTEXT, ctx); } catch (e) { err = e; }

    // RED assertion: result must be defined (resolved). Currently err is defined (threw).
    // This fails while NOT_IMPLEMENTED, passes once 2c is implemented.
    expect(result).toBeDefined();
    expect(err).toBeUndefined();
  });

  it('RED 9b — two encryptSecret calls must yield different ciphertext+nonce (per-write DEK, no reuse)', async () => {
    // RED: encryptSecret throws → neither result is EncryptedColumns → forced fail assertion fires.
    let r1: EncryptedColumns | undefined;
    let r2: EncryptedColumns | undefined;
    let err1: unknown;
    let err2: unknown;
    try { r1 = await svc.encryptSecret(PLAINTEXT, ctx); } catch (e) { err1 = e; }
    try { r2 = await svc.encryptSecret(PLAINTEXT, ctx); } catch (e) { err2 = e; }

    if (r1 !== undefined && r2 !== undefined) {
      // GREEN state (post-2c): ciphertexts and nonces must differ per-write.
      expect(r1.secretCiphertext.equals(r2.secretCiphertext)).toBe(false);
      expect(r1.ivNonce.equals(r2.ivNonce)).toBe(false);
    } else {
      // RED state: both threw. Force failure — the per-write DEK contract cannot be verified.
      // Show that both errors are NOT_IMPLEMENTED (correct throw, not a setup error).
      expect(err1).toBeInstanceOf(Error);
      expect(err2).toBeInstanceOf(Error);
      // Force RED: signal that the contract is unverifiable until 2c resolves.
      expect('encryptSecret throws — per-write DEK uniqueness unverifiable').toBe(
        'encryptSecret resolves — per-write DEK uniqueness verified',
      );
    }
  });

  it('RED 9c — update path: encryptSecret must resolve (currently throws NOT_IMPLEMENTED)', async () => {
    // Update path must generate a fresh DEK (not reuse stored encrypted_dek).
    // RED: throws NOT_IMPLEMENTED → result is undefined → assertion fails.
    let result: EncryptedColumns | undefined;
    let err: unknown;
    try { result = await svc.encryptSecret('new-secret-for-update', ctx); } catch (e) { err = e; }
    expect(result).toBeDefined();
    expect(err).toBeUndefined();
  });
});

// ─── F1 — buildAad collision-resistance (NUL-delimited AAD binding) ──────────
//
// FULL-gate F1: the AAD pins companyId‖recordId‖encAlgo‖dekKeyVersion with a 0x00 delimiter so the
// four fields cannot ambiguously re-segment. These guard the delimiter property directly (the cipher
// round-trip tests above can't, since seal+open share whatever AAD they're given).

describe('F1 — buildAad collision-resistance (NUL-delimited AAD)', () => {
  it('produces NUL-delimited bytes in the pinned field order', () => {
    expect(buildAad('co', 'rec', 'AES-256-GCM', 7).toString('utf8')).toBe('co\x00rec\x00AES-256-GCM\x007');
  });

  it('does not collide on the companyId/recordId boundary (naive concat would: "ab"+"c" == "a"+"bc")', () => {
    expect(buildAad('ab', 'c', 'AES-256-GCM', 1).equals(buildAad('a', 'bc', 'AES-256-GCM', 1))).toBe(false);
  });

  it('does not collide on the encAlgo/dekKeyVersion boundary (naive: "AES-256-GCM"+12 == "AES-256-GCM1"+2)', () => {
    expect(buildAad('co', 'rec', 'AES-256-GCM', 12).equals(buildAad('co', 'rec', 'AES-256-GCM1', 2))).toBe(false);
  });

  it('is deterministic for identical inputs (seal and open rebuild byte-identical)', () => {
    expect(buildAad('co', 'rec', 'AES-256-GCM', 1).equals(buildAad('co', 'rec', 'AES-256-GCM', 1))).toBe(true);
  });
});

// ─── RED 10 — logger-spy: no plaintext / DEK bytes / auth tag in any log ─────

describe('RED 10 — SecretEncryptionService: no plaintext/DEK/authTag in log output', () => {
  // Seam: encryptSecret and decryptSecret throw NOT_IMPLEMENTED:2c, so logger.error is called
  // with the NOT_IMPLEMENTED message which MUST NOT contain the plaintext, DEK bytes, or auth tag.
  // Once 2c is implemented: the real constraint is that the logger never emits sensitive bytes.

  let cipher: EnvelopeCipher;
  let kms: KmsProvider;
  let svc: SecretEncryptionService;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

  const storedCols: EncryptedColumns = {
    secretCiphertext: Buffer.from('fake-ct'),
    encryptedDek: Buffer.from('fake-dek'),
    dekKeyVersion: 1,
    kmsKeyId: 'local-dev-kek',
    ivNonce: Buffer.alloc(12, 0xab),
    authTag: Buffer.alloc(16, 0xcd),
    encAlgo: 'AES-256-GCM',
  };

  beforeEach(() => {
    cipher = makeStubCipher();
    kms = makeStubKms();
    svc = new SecretEncryptionService(cipher as never, kms as never);
    loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function containsSensitiveData(args: unknown[]): boolean {
    const str = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const dekHex = storedCols.encryptedDek.toString('hex');
    const authTagHex = storedCols.authTag.toString('hex');
    return (
      str.includes(PLAINTEXT) ||
      str.includes(dekHex) ||
      str.includes(authTagHex)
    );
  }

  it('RED 10a — encryptSecret must resolve without logging plaintext/DEK (currently throws NOT_IMPLEMENTED)', async () => {
    // RED: encryptSecret throws instead of resolving. The no-leak logger invariant is enforced
    // post-2c by asserting the method resolves AND that no log arg contains sensitive data.
    // Until 2c: the method throws → result is undefined → expect(result).toBeDefined() fails → RED.
    let result: EncryptedColumns | undefined;
    try { result = await svc.encryptSecret(PLAINTEXT, ctx); } catch { /* NOT_IMPLEMENTED */ }

    // RED assertion (fails pre-2c, passes post-2c with correct impl):
    expect(result).toBeDefined();

    // Post-2c invariant (meaningful once result is defined): no log leaks sensitive data.
    for (const call of loggerErrorSpy.mock.calls) {
      expect(containsSensitiveData(call)).toBe(false);
    }
  });

  it('RED 10b — decryptSecret must resolve without logging DEK bytes/authTag (currently throws NOT_IMPLEMENTED)', async () => {
    let result: string | undefined;
    try { result = await svc.decryptSecret(storedCols, ctx); } catch { /* NOT_IMPLEMENTED */ }

    // RED assertion:
    expect(result).toBeDefined();

    for (const call of loggerErrorSpy.mock.calls) {
      expect(containsSensitiveData(call)).toBe(false);
    }
  });

  it('RED 10c — no log argument ever stringifies to the plaintext (entire call chain)', async () => {
    // Capture ALL logger methods, not just error
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    let encResult: EncryptedColumns | undefined;
    let decResult: string | undefined;
    try { encResult = await svc.encryptSecret(PLAINTEXT, ctx); } catch { /* NOT_IMPLEMENTED */ }
    try { decResult = await svc.decryptSecret(storedCols, ctx); } catch { /* NOT_IMPLEMENTED */ }

    // RED: both throw instead of resolving → encResult/decResult are undefined → assertions fail.
    expect(encResult).toBeDefined();
    expect(decResult).toBeDefined();

    const allCalls = [
      ...loggerErrorSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...debugSpy.mock.calls,
      ...logSpy.mock.calls,
    ];
    for (const call of allCalls) {
      const flat = call.map((a: unknown) =>
        typeof a === 'object' ? JSON.stringify(a) : String(a),
      ).join(' ');
      expect(flat).not.toContain(PLAINTEXT);
    }
  });
});
