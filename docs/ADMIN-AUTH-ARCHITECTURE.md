# Admin two-layer authentication and Passkey design

## Verification order

```text
Browser
  │
  ▼
Cloudflare Access (Zero Trust Edge)
  │  Access Policy: only the designated administrator email is allowed
  │  Issues an Access Application JWT after successful verification
  ▼
Cloudflare Worker / Astro middleware
  │  Verifies the RS256 signature, iss, aud, exp, nbf and iat of CF-Access-Jwt-Assertion
  │  Fails closed when verification fails or configuration is missing
  ▼
/admin/login
  │
  ├── Passkey (preferred; WebAuthn + discoverable credential)
  │
  └── Password (fallback; interchangeable with Passkey)
          │
          ▼
  __Host-bm-admin (random session ID + HMAC signature, HttpOnly, Secure, SameSite=Lax, 7 days)
          │
          ▼
  admin_sessions (D1): verifies the signature, checks expiry and revocation on every request
          │
          ▼
  /admin + /api/admin/*
```

Cloudflare Access and site account authentication are two independent checks. Access JWT verification
lives in the Astro middleware, so `/admin`, `/admin/login` and every `/api/admin/*` (including the
Passkey options/verify endpoints) pass through the same Worker-side Access verification first. Merely
having a `CF-Access-Jwt-Assertion` header present is not enough to pass the check.

The only development exception is `astro dev` on `localhost`, `127.0.0.1` or `::1`; production builds
and deployments have no Access bypass.

## Required Cloudflare Access configuration

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications → Add an application → Self-hosted.
2. Create the protection rule on the production site hostname, covering at least:
   - `www.example.com/admin*`
   - `www.example.com/api/admin*`
3. Apply the same Allow Policy to both paths: Include → Emails → add only the administrator mailbox. If
   the Dashboard will not accept multiple Paths on one Application, create two Applications and apply
   the same Policy to each.
4. Copy the **Application Audience (AUD) Tag** from the Access Application's Additional settings.
5. Confirm the team domain on the Zero Trust settings page, for example
   `https://<team-name>.cloudflareaccess.com`.
6. When a single Access Application protects both the pages and the API, set `ACCESS_AUD`; when you split
   them into two Applications, set `ACCESS_ADMIN_AUD` (`/admin*`) and `ACCESS_API_AUD` (`/api/admin*`)
   separately. Do not join the AUDs of different paths into one global allow-list with commas, or a JWT
   could be reused across paths. If either value is missing, the Worker returns 503 for the admin area
   instead of allowing it by default.
7. The Access app must be applied to the production hostname. Even when the site is reached through
   `workers.dev` or another entry point that the Access edge rules do not cover, the Worker middleware
   still requires a validly signed JWT from the same Access issuer and audience.
8. The AUD path-family decision normalises the path first (repeated percent-decoding, `.`／`..` segment
   resolution, collapsed duplicate slashes), so forms such as `//api/admin/*` and `/api/%61dmin/*` are
   still classified as API, and the JWT from the admin-page Application cannot be used to call the API.
   If the middleware fails to load the verifier it fails closed with 503 (text/plain for pages, JSON for
   the API) rather than letting the request through.

The Worker accepts only the `Cf-Access-Jwt-Assertion` header, verifies the RS256 signature against the
public keys from the team domain's `/cdn-cgi/access/certs`, and then checks the exact issuer, the
Application AUD and the time claims. It does not treat the mere presence of the header, the
`CF_Authorization` cookie or a visitor-supplied email as proof of identity.

## First-time Passkey setup

A Passkey and a password are not two consecutive MFA steps but two interchangeable ways to sign in to the
site account. Both must pass Cloudflare Access first.

1. For the first setup, sign in with the existing administrator password.
2. Once you are in `/admin`, click 「設定 Passkey」 in the top-right corner.
3. Complete the ceremony with Windows Hello, Touch ID, Face ID or a security key.
4. After registration, the sign-in page prepares a Passkey challenge on later visits and enables
   Conditional UI while it loads; the account field uses `autocomplete="username webauthn"`, so browsers
   that support it can show the native Passkey picker in that field. You can also click 「使用 Passkey 登入」
   directly.
5. When the device is unsupported, no Passkey is registered, the user cancels or verification fails, expand
   「改用密碼登入」.

A Passkey must be registered on the production site's HTTPS origin. Passkey verification only needs
`ADMIN_SESSION_SECRET`; the password fallback additionally needs `ADMIN_PASSWORD`. If `ADMIN_PASSWORD` is
no longer set, registered Passkeys can still sign in but the password toggle is hidden. Do not remove the
password fallback before you have registered more than one Passkey.

Default settings:

- `ADMIN_WEBAUTHN_RP_ID=www.example.com`
- `ADMIN_WEBAUTHN_ORIGIN=https://www.example.com`

If you move the production hostname to a non-www domain, change both values and open `/admin` from the
same canonical origin. The RP ID is a hostname and contains no scheme, port or path.

### Admin session (revocable)

After either sign-in method succeeds, the same `src/lib/admin-sessions-core.ts` creates the D1 session:

- The `__Host-bm-admin` cookie value is `<session_id>.<issued_at>.<hmac>`: `session_id` is 24 random bytes
  (32 base64url characters) and the HMAC signs `admin.session.<session_id>.<issued_at>` with
  `ADMIN_SESSION_SECRET`; its signing scope differs from the visitor cookie.
- The D1 `admin_sessions` table (`migrations/0008_admin_sessions.sql`) is the sole authority for sessions:
  `expires_at` is 7 days after creation, `revoked_at` marks a revocation and `last_seen_at` records the
  last use (written at most once every 5 minutes).
- `requireAdmin()`, `hasValidAdminSession()` and the `/admin` page guard all verify the HMAC first and then
  read D1 to confirm the session exists, has not expired and has not been revoked. A correct signature with
  no matching D1 row is always treated as signed out.
- Cookies in the old two-part format (`<issued_at>.<signature>`) are always invalid; after the upgrade
  existing administrators have to sign in once more.
- `POST /api/admin/logout` revokes the current session and clears the cookie (deliberately idempotent: it
  still clears the cookie when there is no valid session); the new `POST /api/admin/logout-all` revokes the
  sessions on every device, and `/admin` has a 「登出全部」 button in the top-right corner.
- About 1% of successful sign-ins also delete expired sessions (opportunistic cleanup; a failure does not
  affect the sign-in).

**D1 is part of authentication and must fail closed**: when the D1 binding is missing, a query fails, or
migration `0008` has not been applied (`no such table: admin_sessions`), `/api/admin/*` returns 503 and so
does the `/admin` page, instead of treating the request as signed out. Only "no cookie / bad signature /
session expired or revoked" is a 401. The deploy order must therefore be "apply the remote migration first,
then deploy the code".

### D1 migration

Passkey public keys, signature counters, transports and the five-minute single-use challenges live in D1.
Private keys never leave the user's device.

Run before deploying:

```bash
npx wrangler d1 migrations apply personal-site --remote
```

Passkeys use `migrations/0006_admin_passkeys.sql`; admin sessions use
`migrations/0008_admin_sessions.sql`. One administrator account can register at most 10 Passkeys.
Challenge verification consumes the challenge with a single DELETE ... RETURNING statement, so it cannot be
replayed whether the attempt succeeds or fails. Both migrations must be applied to the remote D1 before the
code that depends on them is deployed.

## API contract

| Route                                 | Method | Purpose                                                          | Sign-in state                                                                                                                           |
| ------------------------------------- | ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/admin/passkey/login-options`    | POST   | Create a short-lived login challenge and return WebAuthn options | Access only                                                                                                                             |
| `/api/admin/passkey/login-verify`     | POST   | Verify the assertion and issue the site session                  | Access only                                                                                                                             |
| `/api/admin/passkey/register-options` | POST   | Create a registration challenge                                  | Access + admin session                                                                                                                  |
| `/api/admin/passkey/register-verify`  | POST   | Verify the registration and store the public key                 | Access + admin session                                                                                                                  |
| `/api/admin/passkeys`                 | GET    | Read the Passkey count and state                                 | Access + admin session                                                                                                                  |
| `/api/admin/login`                    | POST   | Fallback password sign-in                                        | Access only                                                                                                                             |
| `/api/admin/logout`                   | POST   | Revoke the current session and clear the cookie                  | Access + same-origin check (idempotent on purpose: it clears the cookie even when the session expired, so no valid session is required) |
| `/api/admin/logout-all`               | POST   | Revoke the admin session on every device                         | Access + valid admin session + same-origin check                                                                                        |

Every POST checks the exact Origin. The Passkey challenge cookie is HttpOnly, Secure, SameSite=Lax and valid
for 5 minutes; the challenge itself is stored only briefly in D1 and consumed atomically. Both the challenge
and the admin session cookie are HMAC-signed with `ADMIN_SESSION_SECRET`, but each signed payload is bound to
its purpose; the Passkey private key always stays on the user's device.

## Pre-deploy checklist

- [ ] `ACCESS_TEAM_DOMAIN` is set; a single Access app uses `ACCESS_AUD`, two separate Access apps set
      `ACCESS_ADMIN_AUD` and `ACCESS_API_AUD` separately.
- [ ] The Access Policy allows only the administrator email.
- [ ] The Access Application covers `/admin*` and `/api/admin*`, and maps each to the correct AUD when two
      apps are used.
- [ ] `ADMIN_SESSION_SECRET` is set as a Wrangler secret; set `ADMIN_PASSWORD` as well if you want to keep
      the password fallback.
- [ ] `ADMIN_WEBAUTHN_RP_ID` and `ADMIN_WEBAUTHN_ORIGIN` match the real canonical domain.
- [ ] Migrations 0006 and 0008 have been applied to the production D1; without 0008, admin sign-in fails
      closed with 503.
- [ ] You have signed in with the password once and added at least two Passkeys (for example Windows Hello
      plus a phone-synced Passkey), then tested signing out and back in with a Passkey.
- [ ] After testing 「登出全部」, admin sessions in other browsers are invalidated (reusing the old cookie
      returns 401).
- [ ] In testing, removing the Access header or using the wrong AUD makes the Worker respond 403; leaving
      the Access vars unset makes it respond 503.

## Package and lockfile

The backend uses `@simplewebauthn/server` `14.0.3` to verify WebAuthn registration and sign-in responses.
`package-lock.json` already contains this dependency (along with `pinyin-pro` and `to-jyutping`) and was
generated with Node **22.23.4** / npm **10.9.9**; CI runs `npm ci`, so if you add a dependency later,
regenerate the lockfile with npm 10 instead of only editing `package.json`.
