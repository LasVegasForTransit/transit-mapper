-- The secret a browser presents to prove it's the device that created a
-- share, so PATCH/DELETE can be exposed without any account system. NULL for
-- shares created before this migration — those simply aren't editable or
-- revocable by anyone, which is the correct default rather than a hazard.
ALTER TABLE systems ADD COLUMN edit_token_hash TEXT;
