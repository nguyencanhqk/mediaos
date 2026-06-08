import { Module } from '@nestjs/common';
import { loadEnv } from '../config/env.schema';
import { NodeEnvelopeCipher } from './envelope-cipher';
import { LocalKekProvider } from './local-kek.provider';
import { SecretEncryptionService } from './secret-encryption.service';
import { ENVELOPE_CIPHER, KMS_PROVIDER, type KmsProvider } from './secret-encryption.types';
import { VaultKekProvider } from './vault-kek.provider';

/**
 * CryptoModule (G6-2 §6b) — envelope-encryption wiring:
 *   ENVELOPE_CIPHER → NodeEnvelopeCipher (AES-256-GCM AEAD, no KMS/DB knowledge).
 *   KMS_PROVIDER    → LocalKekProvider (dev, file KEK) | VaultKekProvider (prod, transit), by env.KMS_PROVIDER.
 *
 * Exports SecretEncryptionService for PlatformAccountsModule (2e) and the cipher/KMS tokens for the
 * rotation worker (2g). NOT @Global — imported explicitly by the modules that need it.
 */
@Module({
  providers: [
    NodeEnvelopeCipher,
    LocalKekProvider,
    VaultKekProvider,
    SecretEncryptionService,
    { provide: ENVELOPE_CIPHER, useExisting: NodeEnvelopeCipher },
    {
      provide: KMS_PROVIDER,
      useFactory: (local: LocalKekProvider, vault: VaultKekProvider): KmsProvider =>
        loadEnv().KMS_PROVIDER === 'vault' ? vault : local,
      inject: [LocalKekProvider, VaultKekProvider],
    },
  ],
  exports: [SecretEncryptionService, ENVELOPE_CIPHER, KMS_PROVIDER],
})
export class CryptoModule {}
