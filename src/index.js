#!/usr/bin/env node

/**
 * Olliver MCP Server entrypoint.
 *
 * Builds the MCP server (single source of truth for tool registrations) and
 * connects it to the stdio transport. Transport selection moves here in a
 * later step; for now stdio is wired inline to match v1.0.x behavior exactly.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

const server = buildServer();

process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Olliver MCP server running (container mode)");
