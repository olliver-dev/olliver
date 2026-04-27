/**
 * olli serve
 *
 * Start the Olliver MCP server in HTTP transport mode in the foreground.
 * Friendly path for users who'd rather not fight environment variables.
 *
 * Backgrounding is the user's job (systemd, pm2, docker, etc.). Graceful
 * shutdown on SIGINT/SIGTERM is handled inside the transport.
 */

import { handleError } from "../helpers/output.js";

export default function serveCommand(program) {
    program
        .command("serve")
        .description("Start Olliver MCP server in HTTP transport mode")
        .option("--port <port>", "TCP port to listen on (default 3737)")
        .option("--host <host>", "Bind address (default 127.0.0.1)")
        .option("--path <path>", "MCP endpoint path (default /mcp)")
        .option(
            "--log-level <level>",
            "Request log level: error|warn|info|debug (default info)",
        )
        .action(async (opts) => {
            try {
                const overrides = {};
                if (opts.port !== undefined) {
                    const p = Number.parseInt(opts.port, 10);
                    if (!Number.isFinite(p) || p < 1 || p > 65535) {
                        throw new Error(`--port must be a TCP port (1-65535), got "${opts.port}"`);
                    }
                    overrides.port = p;
                }
                if (opts.host !== undefined) overrides.host = opts.host;
                if (opts.path !== undefined) overrides.path = opts.path;
                if (opts.logLevel !== undefined) {
                    overrides.logLevel = String(opts.logLevel).toLowerCase();
                }

                const { buildServer } = await import("../../server.js");
                const { startHttpTransport } = await import(
                    "../../transports/http.js"
                );

                await startHttpTransport(buildServer, overrides);
            } catch (error) {
                handleError(error);
            }
        });
}
