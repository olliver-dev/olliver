/**
 * Streamable HTTP transport — stub for Step 3. Real implementation lands in
 * Step 4. Errors loudly so transport-selection wiring is testable now.
 */

export async function startHttpTransport(_server, _config) {
    console.error(
        "[olliver] HTTP transport not yet implemented. " +
        "Run with OLLIVER_TRANSPORT unset (or =stdio) for now.",
    );
    process.exit(2);
}
