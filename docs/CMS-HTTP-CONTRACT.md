# CMS HTTP method contract

The CMS keeps read-only operations separate from state-changing operations:

| Purpose                                 | Method                                                                    | Where parameters belong                        |
| --------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| List content / filter by collection     | `GET /api/admin/content?collection=blog`                                  | Non-sensitive filter in the query string       |
| Read one content item                   | `GET /api/admin/content/{collection}/{id}`                                | Resource identifier in the path                |
| Search or public page filtering         | `GET` with `q`, `type`, `tag`, etc.                                       | Shareable filter state in the URL              |
| Create content                          | `POST /api/admin/content`                                                 | JSON request body                              |
| Save or publish an existing item        | `POST /api/admin/content/{collection}/{id}`                               | JSON request body                              |
| Delete an item                          | `POST /api/admin/content/{collection}/{id}` with `{ "action": "delete" }` | JSON request body                              |
| Batch edits / taxonomy rename or delete | `POST`                                                                    | JSON request body                              |
| Upload an image                         | `POST /api/admin/upload`                                                  | Multipart `FormData` body                      |
| Login / logout                          | `POST`                                                                    | JSON body for login; no body needed for logout |

Do not put document bodies, authentication values, passwords, tokens, upload metadata,
or mutation payloads in query strings. The browser-facing admin mutation routes also
require an exact same-origin `Origin` header. Read-only `GET` requests remain usable
for normal search, filtering, and shareable URL state.

The login and logout POST endpoints also validate the exact `Origin` header.
Admin POST endpoints fail closed when the `Origin` header is absent or does not
match the request URL origin. GitHub REST API writes made server-to-server by
the CMS may still use GitHub's documented PUT / DELETE verbs; these are not
browser-facing CMS endpoints and their payloads are not placed in URL queries.

`GET /api/admin/content` returns **one effective row per entry**: a D1 draft
overrides the published file's frontmatter, matching the single-entry GET and
the editor save path. Content ids are restricted to the kebab-case form the
repository filenames use, so a path segment can never escape
`src/content/<collection>/`. Batch tools and taxonomy rename/delete update both
the GitHub file and any D1 draft override of the same item in one request; a
deleted item also has its draft removed, so a stale draft cannot resurrect it.

## Admin authentication endpoints

All of these browser-facing endpoints are also protected by the Cloudflare Access Worker middleware. Access must be configured at the Cloudflare edge for both `/admin*` and `/api/admin*`; the Worker verifies the signed `CF-Access-Jwt-Assertion` against the team JWKS, issuer and application AUD before route handling.

| Route                                 | Method | Purpose                                                                              |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `/api/admin/passkey/login-options`    | POST   | Create a five-minute single-use challenge and return discoverable-credential options |
| `/api/admin/passkey/login-verify`     | POST   | Verify the assertion, update its signature counter and issue the site session        |
| `/api/admin/passkey/register-options` | POST   | Generate options for an already authenticated administrator                          |
| `/api/admin/passkey/register-verify`  | POST   | Verify and store a public credential key                                             |
| `/api/admin/passkeys`                 | GET    | Read the current administrator's passkey count                                       |
| `/api/admin/logout`                   | POST   | Revoke the current admin session and clear the cookie (idempotent)                   |
| `/api/admin/logout-all`               | POST   | Revoke every admin session ("log out all devices"); requires an active session       |

Passkey credentials and challenges are stored in D1 after migration `0006_admin_passkeys.sql`. Admin sessions are revocable server-side: the `__Host-bm-admin` cookie carries a random session id plus an HMAC, and every guarded request also checks the matching `admin_sessions` row (`migrations/0008_admin_sessions.sql`) is present, unexpired and unrevoked. Both the password and Passkey login paths create that row. Logout is idempotent and only requires Cloudflare Access; logout-all is the destructive action and therefore requires an active admin session plus the exact same-origin check. If D1 is unavailable (or migration 0008 has not been applied), guarded admin routes fail closed with 503 rather than treating the cookie as invalid. Challenges are atomically consumed with `DELETE ... RETURNING`, including failed verification attempts. The browser never receives or stores an administrator session secret or a credential private key.
