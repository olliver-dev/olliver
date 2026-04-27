# Olliver v1.1.0 — HTTP Transport Validation Plan

Branch: `v1.1.0-http-transport`. This plan is fixed once written; do not
add scope. OAuth, mTLS, and marketplace concerns are explicitly out of
scope and live in v1.2+ work.

## Pre-Validation

- `git checkout v1.1.0-http-transport` from a clean working tree.
- `npm install` from the repo root (`dist/`) to pull in `express` and `cors`.
- `npm link` from `dist/` so `olli` resolves to this branch's bin.
- Confirm `olli --version` reports the package version (still `1.0.0` in
  this stream — version bump happens at release time, not in this branch).
- Verify NAS is mounted (`ls /mnt/n/Projects/olliver` or equivalent) so
  the existing `.olli/` container is reachable for tool smoke tests.
- Note baseline state: `olli status` should show `compinsite`, `olli-dev`,
  `out-the-window`, `ranch`. No HTTP server line (no listener running yet).

---

## 1. Transport Selection

### Test 1.1: Default is stdio
**Action**: `node src/index.js` with no env var. Send an MCP `initialize`
request via stdin.
**Expected**: Server replies on stdout with serverInfo. Stderr prints
`Olliver MCP server running (container mode)`.
**Verify**: `serverInfo.name === "olliver"` in the response. No HTTP
listener bound (`ss -ltn | grep 3737` returns empty).

### Test 1.2: Explicit stdio
**Action**: `OLLIVER_TRANSPORT=stdio node src/index.js`, same handshake.
**Expected**: Identical to Test 1.1.

### Test 1.3: HTTP opt-in
**Action**: `OLLIVER_TRANSPORT=http node src/index.js`.
**Expected**: Stderr prints the HTTP startup banner with
`http://127.0.0.1:3737/mcp` and `http://127.0.0.1:3737/health`. Port 3737
is bound on 127.0.0.1.
**Verify**: `ss -ltn | grep 3737` shows a listener.

### Test 1.4: Unknown value is fatal
**Action**: `OLLIVER_TRANSPORT=banana node src/index.js`.
**Expected**: Stderr prints
`[olliver] OLLIVER_TRANSPORT="banana" is not a valid transport. Use "stdio" (default) or "http".`
Process exits with code 1.
**Verify**: `echo $?` returns `1`.

---

## 2. Stdio Regression — All 22 Tools

For each tool, send `initialize` → `notifications/initialized` →
`tools/call` over stdio. Response must arrive without error
(`isError !== true`) and the payload must match the v1.0.x shape.

| # | Tool | Smoke args | Pass criteria |
|---|---|---|---|
| 2.1 | `list_capsules` | `{environment: "olli-dev"}` | Array of capsule entries, length matches `olli_health` shelf count |
| 2.2 | `read_capsule` | `{environment: "olli-dev", path: "shelf-is-the-api.context.md"}` | Returns capsule content as text |
| 2.3 | `mount_capsule` | `{environment: "olli-dev", path: "shelf-is-the-api.context.md"}` | RACK.md updated |
| 2.4 | `unmount_capsule` | `{environment: "olli-dev", path: "shelf-is-the-api.context.md"}` | RACK.md reverted |
| 2.5 | `get_rack` | `{environment: "olli-dev"}` | Returns mounted list |
| 2.6 | `begin_extraction` | `{environment: "olli-dev", stream_id: "validation-smoke"}` | Returns stream id |
| 2.7 | `write_pass_output` | extraction context | Writes pass file under stream dir |
| 2.8 | `write_draft_capsule` | minimal valid args | Draft `.draft.md` on disk |
| 2.9 | `edit_draft_capsule` | edit the 2.8 draft | Content updated in place |
| 2.10 | `list_drafts` | `{environment: "olli-dev"}` | Includes the 2.8 draft |
| 2.11 | `promote_draft` | promote 2.8 to a sandbox feature name | Draft moves to shelf, SHELF.md updated, batch counter increments |
| 2.12 | `reject_draft` | a separate test draft | Draft archived |
| 2.13 | `scan_receiving` | `{environment: "olli-dev"}` | Returns receiving inventory |
| 2.14 | `stage_source` | a known receiving file | Draft created from receiving |
| 2.15 | `read_manifest` | `{environment: "olli-dev", manifest: "shelf"}` | Returns SHELF.md text |
| 2.16 | `edit_manifest` | a no-op update on the 2.11 entry | Entry unchanged after no-op write |
| 2.17 | `crate_capsule` | crate the 2.11 promotion | File moves to `crated/`, CRATE.md updated, SHELF.md entry removed |
| 2.18 | `uncrate_capsule` | restore 2.17 | File back in `shelf/`, CRATE.md entry removed |
| 2.19 | `create_environment` | `{name: "validation-throwaway"}` | New env scaffolded; appears in subsequent `olli_health` |
| 2.20 | `olli_health` | no args | Returns version + per-env summary |
| 2.21 | `scan_shelf` | `{environment: "olli-dev", mode: "coverage"}` | Returns coverage report |
| 2.22 | `get_help` | `{topic: "transports"}` | Returns the transports.md content |

**Cleanup**: revert SHELF.md/RACK.md/CRATE.md changes from the smoke,
delete the throwaway environment from 2.19.

---

## 3. HTTP Smoke

### Test 3.1: Boot
**Action**: `olli serve` (defaults).
**Expected**: Banner prints. `ss -ltn | grep 3737` confirms listener.

### Test 3.2: Initialize over HTTP
**Action**: `curl -X POST http://127.0.0.1:3737/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'`
**Expected**: 200 response with `result.serverInfo.name === "olliver"`,
`protocolVersion === "2024-11-05"`, and `result.instructions` containing
the `Transport Note` paragraph (length ~16k).

### Test 3.3: tools/list over HTTP
**Action**: POST `tools/list` to `/mcp`.
**Expected**: `result.tools.length === 22`. All names match the v1.0.x set.

---

## 4. Stateless Behavior

### Test 4.1: Sequential requests succeed without session continuity
**Action**: Send three independent POSTs (`initialize`, `tools/list`,
`tools/call name=olli_health`) with no `Mcp-Session-Id` header on any.
**Expected**: All three return 200 with valid JSON-RPC responses. No
error citing missing session.

### Test 4.2: No `Mcp-Session-Id` in responses
**Action**: Inspect response headers from any POST.
**Expected**: `Mcp-Session-Id` header is absent. (Stateful mode would
include it.)

---

## 5. DNS Rebinding Protection

### Test 5.1: Bad Host header rejected
**Action**: `curl -H "Host: evil.com" -X POST http://127.0.0.1:3737/mcp ...`
with a valid initialize body.
**Expected**: 403 Forbidden. JSON body indicates host validation failure.
The MCP server is not reached.

### Test 5.2: Loopback aliases accepted
**Action**: Repeat with `Host: localhost:3737` and `Host: 127.0.0.1:3737`.
**Expected**: Both succeed (200 response with serverInfo).

---

## 6. Loopback Default

### Test 6.1: Bind to 127.0.0.1 unreachable from other interfaces
**Action**: With `olli serve` (default host), attempt to connect from
another machine on the LAN to `http://<test-host-LAN-ip>:3737/health`.
**Expected**: Connection refused / no route to host. Only the loopback
interface accepts connections.
**If single-host test environment**: Skip and note in execution log; the
behavior is implicit in the bind address.

### Test 6.2: 0.0.0.0 binds all interfaces with warning
**Action**: `olli serve --host 0.0.0.0`.
**Expected**: Banner includes the `⚠  Bound to a non-loopback address`
warning block. `ss -ltn | grep 3737` shows `0.0.0.0:3737`.

---

## 7. Tool Surface Over HTTP — All 22 Tools

Repeat the table from §2 over HTTP. Each call: POST to `/mcp` with
`tools/call` JSON-RPC envelope. Same args, same pass criteria. Capture
the same payload shape on stdio and HTTP for at least 3 spot checks
(`olli_health`, `list_capsules`, `read_manifest`).

**Pass criteria per tool**: `isError !== true`, payload matches the
stdio response. Differences are bugs.

**Note**: The `promote_draft` per-environment batch counter resets per
HTTP request (stateless mode). Stdio retains it across calls. This is
documented in `transports.md` and is an accepted behavior delta — not
a regression. Validate that 11 sequential `promote_draft` calls over
HTTP all succeed without hitting the 10-call limit; over stdio, the
11th still hits the limit.

---

## 8. Environment Scoping Over HTTP

### Test 8.1: `environment` parameter respected
**Action**: `tools/call list_capsules` with `environment: "olli-dev"`,
then with `environment: "compinsite"`.
**Expected**: Two distinct, non-overlapping capsule lists matching each
environment's actual shelf contents.

### Test 8.2: No lateral bleed
**Action**: Mount a capsule in `olli-dev`, then call `get_rack` for
`compinsite`.
**Expected**: `compinsite` rack is unchanged. RACK.md files are
per-environment.

---

## 9. Server Instructions

### Test 9.1: Instructions delivered via HTTP initialize
**Action**: HTTP `initialize` from §3.2.
**Expected**: `result.instructions` is a non-empty string containing
both the Tool Reference section and the new `## Transport Note`
paragraph.

### Test 9.2: Stdio parity
**Action**: Stdio `initialize`.
**Expected**: Identical instructions string.

---

## 10. Health Endpoint

### Test 10.1: GET /health 200
**Action**: `curl -i http://127.0.0.1:3737/health`.
**Expected**: `200 OK`, `Content-Type: application/json`, body is
`{"status":"ok","version":"<package version>"}`.

### Test 10.2: Wrong method
**Action**: `curl -X POST http://127.0.0.1:3737/health`.
**Expected**: 404 (Express default — no POST handler on /health).

---

## 11. `olli serve`

### Test 11.1: No flags
**Action**: `olli serve`.
**Expected**: Defaults applied (3737, 127.0.0.1, /mcp, info). Banner
prints. `/health` reachable.

### Test 11.2: Custom port
**Action**: `olli serve --port 8080`.
**Expected**: Listener on 8080. `/health` on 8080 succeeds.

### Test 11.3: Invalid port
**Action**: `olli serve --port 99999`.
**Expected**: Error: `--port must be a TCP port (1-65535)`. Non-zero
exit. No listener bound.

### Test 11.4: Custom path
**Action**: `olli serve --path /api/mcp`. POST initialize to
`/api/mcp`.
**Expected**: Banner reflects the new path. POST to `/api/mcp`
succeeds; POST to `/mcp` returns 404.

### Test 11.5: Log level
**Action**: `olli serve --log-level debug`. Send a request.
**Expected**: Stderr shows `[olliver-http] info: GET ...` lines (debug
threshold includes info-level messages).

### Test 11.6: SIGINT shutdown
**Action**: Start `olli serve`, send SIGINT.
**Expected**: Stderr `[olliver-http] info: received SIGINT, shutting down`.
Process exits 0. Port released.

### Test 11.7: SIGTERM shutdown
**Action**: Start `olli serve`, send SIGTERM.
**Expected**: Same as 11.6 but with `SIGTERM`.

### Test 11.8: `olli status` surfaces running server
**Action**: With `olli serve` running on 3737, run `olli status`.
**Expected**: Output includes a `HTTP server: running at http://127.0.0.1:3737 (vX.Y.Z)`
line. Without a server running, that line is absent.

---

## 12. End-to-End With Real Client

### Test 12.1: Claude Desktop or Cursor via mcp-remote
**Action**: Configure Claude Desktop or Cursor with the `mcp-remote`
bridge snippet from the `olli serve` startup banner. Restart the client.
**Expected**: Olliver shows up in the client's MCP server list. At
least three representative tools work end-to-end:
- one read: `list_capsules` with `environment: "olli-dev"` returns
  the expected list;
- one write: `mount_capsule` updates RACK.md;
- one manifest op: `read_manifest manifest=shelf` returns SHELF.md
  text.

### Test 12.2: Roundtrip from a single client session
**Action**: From the same Claude Desktop or Cursor session as 12.1,
ask the agent: "Run a health check." It should call `olli_health` and
synthesize the response per Pattern 11 of the interaction patterns.
**Expected**: Response mirrors what `olli_health` returns over stdio
in v1.0.x. No transport-specific phrasing.

---

## 13. Backwards Compatibility

### Test 13.1: Existing stdio configs unchanged
**Action**: Use a v1.0.x Claude Desktop config (no `OLLIVER_TRANSPORT`
env, classic `node src/index.js` command) against the v1.1.0 build
installed via `npm link`.
**Expected**: Identical behavior to v1.0.0 — no warnings, no errors,
all 22 tools work.

### Test 13.2: No transport leakage in stdio responses
**Action**: Run any stdio session and inspect responses.
**Expected**: No mention of HTTP, ports, or transports anywhere in
tool responses or instructions, except for the new `## Transport Note`
paragraph in the initialize instructions (which is intentional).

### Test 13.3: `olli install` and `olli help` regressions
**Action**: Run `olli install --help`, `olli status` (without HTTP
server), `olli help` (interactive menu).
**Expected**: All commands behave identically to v1.0.0. The `olli
help` menu lists `Transports` as a new topic. `olli status` does not
emit the HTTP server line if no server is running.

### Test 13.4: Tarball cleanliness
**Action**: From `dist/`, run `npm pack --dry-run`.
**Expected**: Output includes `bin/`, `src/`, `LICENSE`, `README.md`,
`config.example.json`. New files (`src/server.js`, `src/transports/*.js`,
`src/cli/commands/serve.js`, `src/cli/templates/guides/transports.md`)
are present. `VALIDATION-*.md` and `RELEASE-*.md` are NOT present.

---

## Out of Scope (Deferred to v1.2+)

These are intentionally not validated in this plan:
- OAuth 2.1 + Dynamic Client Registration.
- mTLS / IP allowlisting.
- ChatGPT public installation.
- MCPB packaging.
- Apps SDK `search`/`fetch` compatibility tools.

## Validation Execution

Plan only. Dan executes. Follow-ups for failures go in a new draft
capsule (`http-transport-validation-rev1`) on the `olli-dev` Shelf,
not by editing this file.
