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
};

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
 * Resolve transport config. Precedence: explicit overrides (CLI flags) >
 * env vars > defaults. CLI integration calls this with overrides; the env
 * var path passes overrides = {} so env vars take effect.
 */
export function resolveHttpConfig(overrides = {}) {
    const fromEnv = {};
    if (process.env.OLLIVER_HTTP_PORT) {
        const p = Number.parseInt(process.env.OLLIVER_HTTP_PORT, 10);
        if (Number.isFinite(p)) fromEnv.port = p;
    }
    if (process.env.OLLIVER_HTTP_HOST) fromEnv.host = process.env.OLLIVER_HTTP_HOST;
    if (process.env.OLLIVER_HTTP_PATH) fromEnv.path = process.env.OLLIVER_HTTP_PATH;
    if (process.env.OLLIVER_HTTP_LOG_LEVEL) {
        fromEnv.logLevel = process.env.OLLIVER_HTTP_LOG_LEVEL.toLowerCase();
    }

    return { ...DEFAULTS, ...fromEnv, ...overrides };
}

function isLoopbackHost(host) {
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function makeLogger(level) {
    const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;
    return (msgLevel, msg) => {
        if ((LOG_LEVELS[msgLevel] ?? LOG_LEVELS.info) <= threshold) {
            console.error(`[olliver-http] ${msgLevel}: ${msg}`);
        }
    };
}

function printStartupBanner({ url, host, port, version }) {
    const lines = [
        "",
        "Olliver MCP server (HTTP transport)",
        `  Endpoint: ${url}`,
        `  Health:   http://${host}:${port}/health`,
        `  Version:  ${version}`,
        "",
    ];
    if (!isLoopbackHost(host)) {
        lines.push(
            "  ⚠  Bound to a non-loopback address. Anyone reaching this port",
            "     can run any Olliver tool, including writes. There is no",
            "     authentication in this stream — put a TLS reverse proxy with",
            "     auth (Tailscale, Cloudflare Access, nginx + basic auth) in",
            "     front, or restrict the listener with a firewall.",
            "",
        );
    }
    lines.push(
        "  Connect a stdio-only client (Claude Code, Cursor) via mcp-remote:",
        "",
        "  {",
        '    "mcpServers": {',
        '      "olliver": {',
        '        "command": "npx",',
        `        "args": ["-y", "mcp-remote", "${url}"]`,
        "      }",
        "    }",
        "  }",
        "",
        "  ChatGPT custom apps require OAuth. Olliver's OAuth stream is a",
        "  later release; for personal use today, place this server behind a",
        "  network boundary (Tailscale, etc.) and connect clients there.",
        "",
    );
    for (const line of lines) console.error(line);
}

/**
 * Start the HTTP transport. `buildServer` is the factory from src/server.js;
 * the transport calls it per request to mint a fresh McpServer instance, in
 * line with the SDK's stateless pattern.
 */
export async function startHttpTransport(buildServer, configOverrides = {}) {
    const config = resolveHttpConfig(configOverrides);
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

    const allowedOrigins = [
        `http://127.0.0.1:${portStr}`,
        `http://localhost:${portStr}`,
    ];
    if (!isLoopbackHost(config.host)) {
        allowedOrigins.push(`http://${config.host}:${portStr}`);
    }

    const app = express();

    app.use(express.json({ limit: "10mb" }));
    app.use(cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "MCP-Protocol-Version", "Mcp-Session-Id"],
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
