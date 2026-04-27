#!/usr/bin/env node

/**
 * Olliver MCP Server entrypoint.
 *
 * Builds the MCP server (single source of truth for tool registrations) and
 * dispatches it to the selected transport.
 *
 * Transport selection: OLLIVER_TRANSPORT env var.
 *   unset | "stdio" → stdio (default; v1.0.x behavior, unchanged)
 *   "http"          → streamable HTTP (loopback, stateless)
 *   anything else   → fatal
 */

import { buildServer } from "./server.js";
import { startStdioTransport } from "./transports/stdio.js";

const transportMode = (process.env.OLLIVER_TRANSPORT || "stdio").toLowerCase();

switch (transportMode) {
    case "stdio":
        // Single long-lived server for stdio — the spawning client owns one
        // process, and tool state (e.g. promote_draft batch counter) lives
        // for the duration of that process.
        await startStdioTransport(buildServer());
        break;

    case "http": {
        // Stateless HTTP — the transport mints a fresh server per request
        // via the buildServer factory. Imported lazily so stdio users don't
        // pay for express/cors loading.
        const { startHttpTransport } = await import("./transports/http.js");
        await startHttpTransport(buildServer);
        break;
    }

    default:
        console.error(
            `[olliver] OLLIVER_TRANSPORT="${transportMode}" is not a valid ` +
            `transport. Use "stdio" (default) or "http".`,
        );
        process.exit(1);
}
