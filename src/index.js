#!/usr/bin/env node

/**
 * Olliver MCP Server entrypoint.
 *
 * Builds the MCP server (single source of truth for tool registrations) and
 * connects it to a transport. Currently stdio only; transport selection
 * arrives in the next step.
 */

import { buildServer } from "./server.js";
import { startStdioTransport } from "./transports/stdio.js";

const server = buildServer();
await startStdioTransport(server);
