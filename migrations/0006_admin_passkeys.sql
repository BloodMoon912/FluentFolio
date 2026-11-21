-- Single-site administrator WebAuthn credentials and single-use challenges.
-- Only public keys are stored; private key material never leaves the authenticator.
CREATE TABLE IF NOT EXISTS admin_passkeys (
  credential_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL DEFAULT 'unknown',
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_passkeys_created_at ON admin_passkeys(created_at);

CREATE TABLE IF NOT EXISTS admin_webauthn_challenges (
  challenge_id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'register')),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_webauthn_challenges_expiry ON admin_webauthn_challenges(expires_at);
