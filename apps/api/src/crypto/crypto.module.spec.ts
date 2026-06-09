/**
 * G6-2c — CryptoModule wireability. Compiles the DI graph and resolves the public surface
 * (SecretEncryptionService + ENVELOPE_CIPHER + KMS_PROVIDER). With KMS_PROVIDER unset, the factory
 * defaults to LocalKekProvider. No DB / KEK file is touched at construction.
 */

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { CryptoModule } from './crypto.module';
import { NodeEnvelopeCipher } from './envelope-cipher';
import { LocalKekProvider } from './local-kek.provider';
import { SecretEncryptionService } from './secret-encryption.service';
import { ENVELOPE_CIPHER, KMS_PROVIDER } from './secret-encryption.types';

describe('CryptoModule wiring', () => {
  it('compiles and resolves SecretEncryptionService + cipher + local KMS provider', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CryptoModule] }).compile();

    expect(moduleRef.get(SecretEncryptionService)).toBeInstanceOf(SecretEncryptionService);
    expect(moduleRef.get(ENVELOPE_CIPHER)).toBeInstanceOf(NodeEnvelopeCipher);
    expect(moduleRef.get(KMS_PROVIDER)).toBeInstanceOf(LocalKekProvider);

    await moduleRef.close();
  });
});
