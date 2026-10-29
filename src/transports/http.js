/**
 * Streamable HTTP transport — stateless mode.
 *
 * Each POST /mcp request gets a fresh McpServer + transport pair, processes
 * the message, and closes. This is the canonical stateless pattern from the
 * SDK and the natural fit for Olliver: the Shelf is the API, every tool call
 * already reads from disk, and there is no per-client server-side state to
 * preserve across requests.
 *
 * Stateless rationale: sessions in the SDK exist to bind transport-level
 * state (subscriptions, server-initiated sampling, resumable streams) to a
 * client identity. Olliver uses none of those. sessionIdGenerator: undefined
 * + enableJsonResponse: true skips the entire session-dictionary code path.
 *
 * Defaults to loopback (127.0.0.1:3737/mcp) with DNS rebinding protection,
 * restrictive CORS, request logging, and a /health endpoint. The user is
 * responsible for not exposing a non-auth listener to the public internet —
 * see the in-package transports/http-mode guide.
 */

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULTS = {
    port: 3737,
    host: "127.0.0.1",
    path: "/mcp",
    logLevel: "info",
    lanToken: null,
    cfTeamDomain: null,
    cfAud: null,
    allowedHosts: [],
    expose: null,
};

const LAN_TOKEN_MIN_LENGTH = 32;

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function readPackageVersion() {
    try {
        const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
        return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    } catch {
        return "unknown";
    }
}

/**
 * Split a comma-separated list (env var or CLI flag) into trimmed,
 * non-empty entries. Arrays get the same normalization.
 */
function parseList(value) {
    if (value === undefined || value === null) return [];
    const items = Array.isArray(value) ? value : String(value).split(",");
    return items.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * Accept "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/"
 * and return the bare host that the issuer and certs URL are built from.
 */
function normalizeTeamDomain(value) {
    if (!value) return null;
    const bare = String(value).trim().replace(/^https:\/\//i, "").replace(/\/+$/, "");
    return bare || null;
}

/**
 * Resolve transport config. Precedence: explicit overrides (CLI flags) >
 * env vars > defaults. CLI integration calls this with overrides; the env
 * var path passes overrides = {} so env vars take effect.
 *
 * The LAN token is env-only by design — a flag would leak it into shell
 * history and the process table.
 */
export function resolveHttpConfig(overrides = {}) {
    const env = process.env;
    const fromEnv = {};
    if (env.OLLIVER_HTTP_PORT) {
        const p = Number.parseInt(env.OLLIVER_HTTP_PORT, 10);
        if (Number.isFinite(p)) fromEnv.port = p;
    }
    if (env.OLLIVER_HTTP_HOST) fromEnv.host = env.OLLIVER_HTTP_HOST;
    if (env.OLLIVER_HTTP_PATH) fromEnv.path = env.OLLIVER_HTTP_PATH;
    if (env.OLLIVER_HTTP_LOG_LEVEL) {
        fromEnv.logLevel = env.OLLIVER_HTTP_LOG_LEVEL.toLowerCase();
    }
    if (env.OLLIVER_LAN_TOKEN) fromEnv.lanToken = env.OLLIVER_LAN_TOKEN;
    if (env.OLLIVER_CF_TEAM_DOMAIN) fromEnv.cfTeamDomain = env.OLLIVER_CF_TEAM_DOMAIN;
    if (env.OLLIVER_CF_AUD) fromEnv.cfAud = env.OLLIVER_CF_AUD;
    if (env.OLLIVER_HTTP_ALLOWED_HOSTS) fromEnv.allowedHosts = env.OLLIVER_HTTP_ALLOWED_HOSTS;
    if (env.OLLIVER_EXPOSE) fromEnv.expose = env.OLLIVER_EXPOSE;

    const merged = { ...DEFAULTS, ...fromEnv, ...overrides };
    const expose = parseList(merged.expose);

    return {
        ...merged,
        cfTeamDomain: normalizeTeamDomain(merged.cfTeamDomain),
        cfAud: merged.cfAud ? String(merged.cfAud).trim() : null,
        allowedHosts: parseList(merged.allowedHosts),
        expose: expose.length > 0 ? expose : null,
    };
}

function isLoopbackHost(host) {
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Enforce the startup rules and report which auth doors are enabled.
 * Throws with a message naming the env vars to set; never echoes a secret.
 *
 *   front — Cloudflare Access JWT (needs both team domain and AUD)
 *   side  — LAN bearer token (OLLIVER_LAN_TOKEN, >= 32 chars)
 *
 * A non-loopback bind with neither door configured is refused outright.
 */
export function resolveDoors(config) {
    const hasTeam = Boolean(config.cfTeamDomain);
    const hasAud = Boolean(config.cfAud);

    if (hasTeam !== hasAud) {
        throw new Error(
            "Cloudflare Access needs both OLLIVER_CF_TEAM_DOMAIN (--cf-team-domain) " +
            "and OLLIVER_CF_AUD (--cf-aud); only one is set.",
        );
    }

    if (config.lanToken && config.lanToken.length < LAN_TOKEN_MIN_LENGTH) {
        throw new Error(
            `OLLIVER_LAN_TOKEN must be at least ${LAN_TOKEN_MIN_LENGTH} characters.`,
        );
    }

    const doors = {
        front: hasTeam && hasAud,
        side: Boolean(config.lanToken),
    };

    if (!isLoopbackHost(config.host) && !doors.front && !doors.side) {
        throw new Error(
            `Refusing to bind ${config.host} with no auth door configured. ` +
            "Set OLLIVER_LAN_TOKEN (side door) and/or OLLIVER_CF_TEAM_DOMAIN + " +
            "OLLIVER_CF_AUD (front door), or bind to 127.0.0.1.",
        );
    }

    return doors;
}

function makeLogger(level) {
    const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    return (msgLevel, msg) => {
        if ((LOG_LEVELS[msgLevel] ?? LOG_LEVELS.info) <= threshold) {
            console.error(`[olliver-http] ${msgLevel}: ${msg}`);
        }
    };
}

function printStartupBanner({ url, host, port, version, config, doors }) {
    const lines = [
        "",
        "Olliver MCP server (HTTP transport)",
        `  Endpoint: ${url}`,
        `  Health:   http://${host}:${port}/health`,
        `  Version:  ${version}`,
        "",
        "  Doors:",
        `    Front (Cloudflare Access): ${doors.front ? `enabled — ${config.cfTeamDomain}` : "disabled"}`,
        `    Side  (LAN bearer token):  ${doors.side ? "enabled" : "disabled"}`,
    ];
    if (config.allowedHosts.length > 0) {
        lines.push(`  Allowed hosts: ${config.allowedHosts.join(", ")}`);
    }
    if (config.expose) {
        lines.push(`  Exposed environments: ${config.expose.join(", ")}`);
    }
    lines.push("");

    if (!doors.front && !doors.side) {
        lines.push(
            "  ⚠  No auth doors configured — loopback dev mode, every request is allowed.",
            "",
        );
    }

    lines.push(
        "  Connect a stdio-only client (Claude Code, Codex, Desktop) via mcp-remote:",
        "",
        "  {",
        '    "mcpServers": {',
        '      "olliver": {',
        '        "command": "npx",',
    );
    if (doors.side) {
        lines.push(
            `        "args": ["-y", "mcp-remote", "${url}",`,
            '                 "--header", "Authorization: Bearer ${OLLIVER_LAN_TOKEN}"],',
            '        "env": { "OLLIVER_LAN_TOKEN": "<your LAN token>" }',
        );
    } else {
        lines.push(`        "args": ["-y", "mcp-remote", "${url}"]`);
    }
    lines.push(
        "      }",
        "    }",
        "  }",
        "",
    );

    if (doors.front) {
        lines.push(
            "  ChatGPT, Copilot, Gemini, Grok, and claude.ai connect through the",
            "  front door: your Cloudflare Tunnel hostname, behind Cloudflare Access",
            "  with Managed OAuth. See `olli help` → Transports.",
            "",
        );
    } else {
        lines.push(
            "  Hosted clients (ChatGPT, Copilot, Gemini, Grok, claude.ai) need the",
            "  front door: set OLLIVER_CF_TEAM_DOMAIN and OLLIVER_CF_AUD and put a",
            "  Cloudflare Tunnel + Access app in front. See `olli help` → Transports.",
            "",
        );
    }
    for (const line of lines) console.error(line);
}

/**
 * Start the HTTP transport. `buildServer` is the factory from src/server.js;
 * the transport calls it per request to mint a fresh McpServer instance, in
 * line with the SDK's stateless pattern.
 */
export async function startHttpTransport(buildServer, configOverrides = {}) {
    const config = resolveHttpConfig(configOverrides);
    const doors = resolveDoors(config);
    const log = makeLogger(config.logLevel);
    const version = readPackageVersion();

    const portStr = String(config.port);
    const allowedHosts = [
        "127.0.0.1",
        `127.0.0.1:${portStr}`,
        "localhost",
        `localhost:${portStr}`,
    ];
    if (!isLoopbackHost(config.host) && !allowedHosts.includes(config.host)) {
        allowedHosts.push(config.host, `${config.host}:${portStr}`);
    }

    // Extra hostnames (e.g. the Cloudflare Tunnel public hostname) join the
    // rebinding allowlist bare and with the port. Protection stays on.
    const extraHosts = config.allowedHosts.map((h) => h.toLowerCase());
    for (const extra of extraHosts) {
        for (const candidate of [extra, `${extra}:${portStr}`]) {
            if (!allowedHosts.includes(candidate)) allowedHosts.push(candidate);
        }
    }

    // Requests without an Origin header (server-to-server, CLI clients)
    // pass the SDK's origin check untouched; this list only gates browsers.
    const allowedOrigins = [
        `http://127.0.0.1:${portStr}`,
        `http://localhost:${portStr}`,
    ];
    if (!isLoopbackHost(config.host)) {
        allowedOrigins.push(`http://${config.host}:${portStr}`);
    }
    for (const extra of extraHosts) {
        allowedOrigins.push(`https://${extra}`);
    }

    const app = express();

    app.use(express.json({ limit: "10mb" }));
    app.use(cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "MCP-Protocol-Version",
            "Mcp-Session-Id",
            "Authorization",
            "Cf-Access-Jwt-Assertion",
        ],
    }));

    app.use((req, res, next) => {
        const start = Date.now();
        res.on("finish", () => {
            log(
                "info",
                `${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`,
            );
        });
        next();
    });

    app.get("/health", (_req, res) => {
        res.type("application/json").status(200).json({
            status: "ok",
            version,
        });
    });

    app.post(config.path, async (req, res) => {
        const reqServer = buildServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
            enableDnsRebindingProtection: true,
            allowedHosts,
            allowedOrigins,
        });
        res.on("close", () => {
            transport.close().catch(() => {});
            reqServer.close().catch(() => {});
        });
        try {
            await reqServer.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            log("error", `transport.handleRequest failed: ${err?.message || err}`);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                    id: null,
                });
            }
        }
    });

    const httpServer = app.listen(config.port, config.host, () => {
        const url = `http://${config.host}:${config.port}${config.path}`;
        printStartupBanner({
            url,
            host: config.host,
            port: config.port,
            version,
            config,
            doors,
        });
    });

    httpServer.on("error", (err) => {
        log("error", `listen failed: ${err.message}`);
        process.exit(1);
    });

    const shutdown = async (signal) => {
        log("info", `received ${signal}, shutting down`);
        httpServer.close(() => {
            log("info", "HTTP listener closed");
        });
        process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}
