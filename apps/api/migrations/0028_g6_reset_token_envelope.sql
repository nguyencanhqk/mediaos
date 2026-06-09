-- Migration 0028: G6-2f — reset-token envelope support (auth.service.ts forgotPassword → envelope).
-- Three concerns (plan §6d / RED ca 12):
--   (1) Seed encryption_keys for purpose='auth_reset_token' so SecretEncryptionService can wrap the DEK
--       used when forgotPassword envelopes the reset token. Mirror 0022:108-110 exactly: same kms_key_id
--       'local-dev-kek' because LocalKekProvider uses ONE file KEK regardless of purpose. ⚠️ Prod cutover
--       must override this with real Vault provisioning (gated — see plan §6d / 2a CARRY-FORWARD).
--   (2) One-time SCRUB of any pre-existing outbox row still carrying the plaintext reset token. IRREVERSIBLE
--       by design — plaintext is NOT recoverable (plan §12 down-revert note: scrub does not revert).
--   (3) Defense-in-depth TRIGGER that strips the plaintext 'resetToken' key on every write to outbox_events
--       for that event type. RED 12d inserts a legacy plaintext row at RUNTIME (after this migration has
--       already run), so a one-time scrub alone cannot neutralize it — the trigger holds the invariant for
--       every future write and also catches an app regression that re-adds plaintext. It strips ONLY the
--       plaintext key; the 'resetTokenEnc' envelope written by 2f is left untouched.
-- ⚠️ Journal: idx 29 / when 1717500032000 (> max-applied 1717500031000 of 0027) so the drizzle migrator
--    does NOT skip it. NOT base+idx (0022 took idx 27/when 30000, 0027 idx 28/when 31000).

-- (1) Seed the auth_reset_token key (encryption_keys is GLOBAL — no RLS — migration 0022).
INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status)
VALUES (1, 'local-dev-kek', 'auth_reset_token', 'active')
ON CONFLICT (purpose, key_version) DO NOTHING;
--> statement-breakpoint

-- (2) One-time scrub: drop the plaintext reset token from any pre-existing reset-request outbox row.
UPDATE outbox_events
SET payload = payload - 'resetToken', updated_at = now()
WHERE event_type = 'auth.password_reset_requested'
  AND payload ? 'resetToken';
--> statement-breakpoint

-- (3a) Trigger function: never let a plaintext reset token persist in the outbox. Strips ONLY the
--      plaintext key — leaves 'resetTokenEnc' (the envelope) intact. NULL payload never reaches here
--      (payload is NOT NULL); the event_type guard short-circuits all other event types cheaply.
CREATE OR REPLACE FUNCTION scrub_reset_token_plaintext() RETURNS trigger AS $$
BEGIN
  IF NEW.event_type = 'auth.password_reset_requested' AND NEW.payload ? 'resetToken' THEN
    NEW.payload := NEW.payload - 'resetToken';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- (3b) BEFORE INSERT OR UPDATE OF payload: fires on every INSERT and only on UPDATEs that target the
--      payload column (the worker's status/attempts UPDATEs never touch payload → zero hot-path overhead).
CREATE TRIGGER outbox_scrub_reset_token
  BEFORE INSERT OR UPDATE OF payload ON outbox_events
  FOR EACH ROW
  EXECUTE FUNCTION scrub_reset_token_plaintext();
