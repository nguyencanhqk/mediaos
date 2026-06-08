/**
 * G6-2c unit suite — LocalKekProvider (DEV KMS: file KEK + encryption_keys registry).
 *
 * The DB module is mocked so `currentKey()` never opens a real connection (vitest bakes DATABASE_URL but
 * Docker may be down). wrap/unwrap run against a real tmp KEK file with `currentKey` stubbed, so they
 * exercise the genuine AES-256-GCM DEK-wrap + AAD binding, not a mock.
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DB BEFORE importing the provider (hoisted). currentKey() reads through this.
vi.mock('../db', () => ({ db: { execute: vi.fn() } }));

import { db } from '../db';
import { LocalKekProvider } from './local-kek.provider';

const execMock = (db as unknown as { execute: ReturnType<typeof vi.fn> }).execute;
const ORIGINAL_KEK_PATH = process.env.KMS_LOCAL_KEK_PATH;
const createdDirs: string[] = [];

function writeTmpKek(bytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'kek-'));
  createdDirs.push(dir);
  const file = join(dir, 'kek.bin');
  writeFileSync(file, randomBytes(bytes));
  return file;
}

function restoreKekPath(): void {
  if (ORIGINAL_KEK_PATH === undefined) delete process.env.KMS_LOCAL_KEK_PATH;
  else process.env.KMS_LOCAL_KEK_PATH = ORIGINAL_KEK_PATH;
}

afterEach(() => {
  restoreKekPath();
  vi.restoreAllMocks();
  while (createdDirs.length) rmSync(createdDirs.pop()!, { recursive: true, force: true });
});

describe('LocalKekProvider.currentKey — encryption_keys registry (GLOBAL)', () => {
  beforeEach(() => execMock.mockReset());

  it('returns the active key (highest key_version) for the purpose', async () => {
    execMock.mockResolvedValue({ rows: [{ kms_key_id: 'local-dev-kek', key_version: 1 }] });
    const result = await new LocalKekProvider().currentKey('platform_account');
    expect(result).toEqual({ kmsKeyId: 'local-dev-kek', keyVersion: 1 });
  });

  it('fail-closed: throws when no active key exists for the purpose', async () => {
    execMock.mockResolvedValue({ rows: [] });
    await expect(new LocalKekProvider().currentKey('auth_reset_token')).rejects.toThrow(
      /không có encryption key 'active'/,
    );
  });
});

describe('LocalKekProvider — DEK wrap/unwrap under file KEK', () => {
  let provider: LocalKekProvider;

  beforeEach(() => {
    process.env.KMS_LOCAL_KEK_PATH = writeTmpKek(32);
    provider = new LocalKekProvider();
    // Pin the key identity so wrap/unwrap focus on the AEAD path (currentKey is covered separately).
    vi.spyOn(provider, 'currentKey').mockResolvedValue({ kmsKeyId: 'local-dev-kek', keyVersion: 1 });
  });

  it('round-trips: unwrap(wrap(dek)) === dek and reports the pinned key identity', async () => {
    const dek = randomBytes(32);
    const wrapped = await provider.wrapDek(dek, 'platform_account');

    expect(wrapped.kmsKeyId).toBe('local-dev-kek');
    expect(wrapped.keyVersion).toBe(1);
    expect(wrapped.wrapped.equals(dek)).toBe(false); // wrapped is iv‖tag‖ct, never the raw DEK

    const unwrapped = await provider.unwrapDek(wrapped.wrapped, wrapped.kmsKeyId, wrapped.keyVersion);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it('tampered wrapped DEK → unwrap throws (GCM tag mismatch)', async () => {
    const dek = randomBytes(32);
    const { wrapped, kmsKeyId, keyVersion } = await provider.wrapDek(dek, 'platform_account');
    const tampered = Buffer.from(wrapped);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(provider.unwrapDek(tampered, kmsKeyId, keyVersion)).rejects.toThrow();
  });

  it('wrong keyVersion at unwrap → AAD mismatch throws (wrap bound to key identity)', async () => {
    const dek = randomBytes(32);
    const { wrapped, kmsKeyId } = await provider.wrapDek(dek, 'platform_account');
    await expect(provider.unwrapDek(wrapped, kmsKeyId, 999)).rejects.toThrow();
  });
});

describe('LocalKekProvider — KEK file fail-fast', () => {
  it('missing KEK file → clear error (no key bytes)', async () => {
    process.env.KMS_LOCAL_KEK_PATH = join(tmpdir(), 'kek-absent-dir-xyz', 'kek.bin');
    const provider = new LocalKekProvider();
    vi.spyOn(provider, 'currentKey').mockResolvedValue({ kmsKeyId: 'local-dev-kek', keyVersion: 1 });
    await expect(provider.wrapDek(randomBytes(32), 'platform_account')).rejects.toThrow(
      /không đọc được file KEK/,
    );
  });

  it('wrong-length KEK file → fail-fast (must be exactly 32 bytes)', async () => {
    process.env.KMS_LOCAL_KEK_PATH = writeTmpKek(16);
    const provider = new LocalKekProvider();
    vi.spyOn(provider, 'currentKey').mockResolvedValue({ kmsKeyId: 'local-dev-kek', keyVersion: 1 });
    await expect(provider.wrapDek(randomBytes(32), 'platform_account')).rejects.toThrow(
      /KEK phải đúng 32 byte/,
    );
  });
});
