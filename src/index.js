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

const server = buildServer();

switch (transportMode) {
    case "stdio":
        await startStdioTransport(server);
        break;

    case "http": {
        // Step 4 wires this up. Stubbed here so transport selection is
        // testable independently of the HTTP implementation.
        const { startHttpTransport } = await import("./transports/http.js");
        await startHttpTransport(server);
        break;
    }

    default:
        console.error(
            `[olliver] OLLIVER_TRANSPORT="${transportMode}" is not a valid ` +
            `transport. Use "stdio" (default) or "http".`,
        );
        process.exit(1);
}
