/**
 * Stdio transport — the default. Connects the MCP server to the SDK's
 * StdioServerTransport so a parent process can spawn Olliver and speak
 * MCP over stdin/stdout. Logs server status to stderr.
 *
 * Owns its own SIGINT/SIGTERM handling: close the SDK Server cleanly,
 * then exit. Other transports register their own shutdown.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function startStdioTransport(server) {
    const shutdown = async () => {
        await server.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Olliver MCP server running (container mode)");
}
