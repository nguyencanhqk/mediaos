-- Migration 0029: G6-2f follow-up — make the reset-token scrub trigger OBSERVABLE.
-- FULL-gate 2f finding (silent-failure-hunter F2, MEDIUM): the 0028 trigger silently strips a plaintext
-- 'resetToken' key, so an app regression that re-introduces plaintext is corrected with NO signal — masking
-- the bug. Re-define the trigger function (CREATE OR REPLACE updates the body in place; the trigger created
-- in 0028 keeps pointing at it) so it RAISEs a WARNING when it actually fires. WARNING propagates to the
-- server log WITHOUT aborting the tx, preserving the defense-in-depth strip while making regressions visible.
-- ⚠️ NEVER log the token value — only the event_type + row id.
-- ⚠️ Journal: idx 30 / when 1717500033000 (> max-applied 1717500032000 of 0028).

CREATE OR REPLACE FUNCTION scrub_reset_token_plaintext() RETURNS trigger AS $$
BEGIN
  IF NEW.event_type = 'auth.password_reset_requested' AND NEW.payload ? 'resetToken' THEN
    RAISE WARNING 'outbox_scrub_reset_token: stripped plaintext resetToken (event_type=%, row_id=%) — app regression?',
      NEW.event_type, NEW.id;
    NEW.payload := NEW.payload - 'resetToken';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
