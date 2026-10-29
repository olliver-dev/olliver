# Olliver v1.1.0 — HTTP Transport Validation, rev1 Addendum

Branch: `v1.1.0-http-transport`. This addendum covers only the rev1 pass:
two-door auth (Cloudflare Access front door, LAN bearer side door), the
host allowlist, path safety, single-writer safety, and tool annotations.
`VALIDATION-v1_1_0-http-transport.md` is unchanged and still governs
everything else. Where the two disagree, this file wins for the rev1 scope
only — notably §6.2 of the original (0.0.0.0 boots with a warning) is
superseded by Gate 2 here (0.0.0.0 with no door refuses to start).

## Scratch Environment

Every gate runs against a throwaway Shelf, never the real one:

- `HOME` **and** `USERPROFILE` point at a temp dir. On Windows,
  `os.homedir()` reads `USERPROFILE`, so setting `HOME` alone would fall
  through to the real `~/.olliver`.
- That temp home holds its own `.olliver` dotfile pointing at a temp
  `.olli/` container with two environments, `envA` and `envB`. Each has
  `SHELF.md` (one seed entry), `RACK.md`, `CRATE.md`, `shelf/` (one
  capsule), `receiving/` (one file), `drafts/`, `extractions/`, `crated/`.
- All inherited `OLLIVER_*` variables are stripped before each server
  starts. HTTP servers bind `127.0.0.1` only (no firewall prompts, nothing
  reachable off-box).

## Gates

### Gate 1: Syntax and tarball
**Action**: `node --check` on every `.js` file changed since `777cda4`;
`npm pack --dry-run` from `dist/`.
**Expected**: All checks pass. Pack exits 0, includes
`src/shared/safe-segment.js`, `src/shared/write-file-atomic.js`,
`src/transports/http.js`, `src/cli/templates/guides/transports.md`, and
excludes `VALIDATION-*`, `RELEASE-*`, `.olli/`.

### Gate 2: No unauthenticated door
**Action**: `OLLIVER_TRANSPORT=http OLLIVER_HTTP_HOST=0.0.0.0 node src/index.js`
with no doors; same via `olli serve --host 0.0.0.0`.
**Expected**: Exit 1 with a message naming `OLLIVER_LAN_TOKEN` and
`OLLIVER_CF_TEAM_DOMAIN` + `OLLIVER_CF_AUD`. No listener bound.
**Also**: a 31-character `OLLIVER_LAN_TOKEN` exits 1; only one of the
Cloudflare pair set exits 1.

### Gate 3: Side door
**Action**: Server with `OLLIVER_LAN_TOKEN` (64 hex chars). POST
`tools/list` with the correct bearer, a wrong bearer, and none.
**Expected**: Correct → 200 with 22 tools; the nine read-only tools
(`list_capsules`, `read_capsule`, `get_rack`, `list_drafts`,
`read_manifest`, `scan_receiving`, `olli_health`, `get_help`, `scan_shelf`)
carry `readOnlyHint: true, openWorldHint: false`; the other 13 carry
`readOnlyHint: false, destructiveHint: false, openWorldHint: false`.
Wrong and missing → 401 with exactly
`{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}`.
`GET /health` stays open and returns only `status` and `version`.

### Gate 4: Front door
**Method**: To exercise real signature checking without test hooks in the
product, the gate serves an Access-shaped JWKS at
`https://127.0.0.1:3849/cdn-cgi/access/certs` from a throwaway self-signed
cert (SAN `IP:127.0.0.1`), trusted by the server process via
`NODE_EXTRA_CA_CERTS`. The server runs with
`OLLIVER_CF_TEAM_DOMAIN=127.0.0.1:3849` and a test AUD, so the issuer is
`https://127.0.0.1:3849`. JWTs are RS256, built with `node:crypto`.
**Expected**:
- Garbage `Cf-Access-Jwt-Assertion` → 401.
- JWT signed with a local key not in the JWKS → 401, both with a `kid`
  matching the Access key (signature check fails) and with an unknown `kid`.
- **Control**: JWT signed by the JWKS key with correct issuer, audience
  and expiry → 200, logged as `door=front`. Proves the 401s above come
  from verification, not from an unreachable JWKS.
- Access-signed JWT with the wrong audience → 401; expired → 401.
- Bad assertion plus a valid LAN bearer → 401 (Authorization is ignored
  on the front-door path).

### Gate 5: Host allowlist
**Action**: Server with `OLLIVER_HTTP_ALLOWED_HOSTS=olliver.shareport.io`;
second server without it. Valid LAN bearer on every request.
**Expected**: With the allowlist, `Host: olliver.shareport.io`,
`Host: olliver.shareport.io:3833`, and the same with
`Origin: https://olliver.shareport.io` all → 200; `Host: evil.example.com`
→ 403. Without the allowlist, `Host: olliver.shareport.io` → 403
(`Invalid Host header`).

### Gate 6: Traversal
**Action**: Against `read_capsule` (`path`), `stage_source` (`filename`),
`write_draft_capsule` (`filename`) and `edit_manifest` (`file`), send:
`environment: "../x"`; `"../../etc/passwd"`; `"/etc/passwd"`;
`"C:\Windows\win.ini"`.
**Expected**: Every call returns `isError: true` with an `Invalid …`
message. No file is created anywhere under the scratch tree and no
manifest entry is written.

### Gate 7: Concurrent writers
**Action**: 20 concurrent `edit_manifest` adds (`Concurrent 1..20`) to
`envA` over HTTP.
**Expected**: 20/20 succeed; `read_manifest` parses with
`entry_count: 21` (1 seed + 20) and every feature present; no `.tmp-`
files remain anywhere in the container.

### Gate 8: OLLIVER_EXPOSE
**Action**: Server with `OLLIVER_EXPOSE=envA`.
**Expected**: `olli_health` lists only `envA`. `list_capsules` and
`read_capsule` on `envB` return `Environment "envB" not found. Available:
envA` — the same shape as a genuinely nonexistent environment. Numeric
selection `"2"` can't reach it. Omitting `environment` auto-selects `envA`.
`create_environment` with a name outside the list is refused without
creating anything and without revealing whether it exists.

### Gate 9: Loopback dev mode
**Action**: Server on `127.0.0.1` with no doors. POST `tools/list` with no
credentials.
**Expected**: 200 with 22 tools. Banner prints the one-line
`No auth doors configured` warning.

### Gate 10: Stdio spot check
**Action**: `node src/index.js` (no `OLLIVER_TRANSPORT`): `initialize`,
`notifications/initialized`, `tools/list`, `olli_health`, then
`read_capsule` with `path: "../../etc/passwd"`, each awaited in turn.
**Expected**: 22 tools; `olli_health` sees both `envA` and `envB`
(EXPOSE is HTTP-only); the traversal is rejected (path safety applies to
all transports).

### Log hygiene (all gates)
**Expected**: Across every server log captured above, no LAN token, no
JWT, and no capsule content appears. Auth rejections log a reason code
only (e.g. `front door ERR_JWS_SIGNATURE_VERIFICATION_FAILED`).

## Results

Executed 2026-10-29 against `7dee40d` on Windows 11, Node v25.2.1,
`@modelcontextprotocol/sdk` 1.26.0, `jose` 6.1.3. 43/43 checks passed.

| Gate | Result | Evidence |
|---|---|---|
| 1 | PASS | 6 changed `.js` files pass `node --check`; pack exit 0, 49 files, none of VALIDATION/RELEASE/.olli |
| 2 | PASS | 0.0.0.0 (env and `olli serve`), 31-char token, half Cloudflare pair — all exit 1 with named env vars |
| 3 | PASS | 200 / 22 tools; 9 read-only + 13 write annotations correct; wrong and missing token → exact 401 envelope; `/health` = status + version |
| 4 | PASS | garbage, forged (matching kid), forged (unknown kid), wrong aud, expired, bad assertion + valid bearer → 401; control → 200 `door=front`. Logged codes: `ERR_JWS_INVALID`, `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`, `ERR_JWKS_NO_MATCHING_KEY`, `ERR_JWT_CLAIM_VALIDATION_FAILED`, `ERR_JWT_EXPIRED` |
| 5 | PASS | allowlisted bare / host:port / +Origin → 200; unlisted → 403; not allowlisted → 403 `Invalid Host header` |
| 6 | PASS | 16/16 attempts rejected across the four tools; no files created, no entries written |
| 7 | PASS | 20/20 ok; `entry_count` 21; no `.tmp-` files |
| 8 | PASS | only `envA` listed; `envB` not-found (same shape as nonexistent); `"2"` not-found; auto-select `envA`; create outside list refused |
| 9 | PASS | 200 / 22 tools with no credentials; dev-mode warning printed |
| 10 | PASS | 22 tools over stdio; both environments visible; traversal rejected |
| Logs | PASS | 9 server logs scanned for 6 secrets: none found; no capsule content |

## Findings Outside rev1 Scope

Observed during execution; not changed in this pass.

- **Stdio first-call race (pre-existing).** `resolveOlliContainer()` sets
  `_shelfResolved = true` before awaiting the dotfile read. On a long-lived
  stdio server, a second tool call that arrives while the first is still
  resolving skips the dotfile and walks up from cwd, failing with
  `.olli/ container not found` unless cwd happens to be under the Shelf.
  Reproduced by firing `olli_health` and `read_capsule` back-to-back on a
  fresh stdio process. HTTP is unaffected (fresh server per request).
- **`uncrate_capsule` restores the timestamped name** (`x-<ts>.context.md`),
  not the original filename, and doesn't restore the SHELF.md entry.
- **Absolute server paths in tool results.** `list_capsules` (`fullPath`),
  `list_drafts`, draft/extraction results and `olli_health` (`container`)
  return absolute filesystem paths, now visible to hosted clients through
  the front door.
- **`olli_health` makes an outbound request** to the npm registry (upgrade
  check) while annotated `openWorldHint: false`, per the rev1 spec.
- **`jose` 6 and `engines.node >= 18`.** jose 6.1.3 declares no engines
  and calls the global WebCrypto `crypto.subtle`, which Node exposes
  unflagged from v19. The SDK already depends on `jose ^6.1.3` while also
  claiming `>=18`, so this predates rev1 — but Olliver's `>=18` is worth
  confirming on a real Node 18 or raising (Node 18 is EOL).
