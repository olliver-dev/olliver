/**
 * Path Safety
 *
 * Tool arguments are untrusted on every transport — stdio or HTTP. Any
 * argument that becomes part of a filesystem path goes through
 * safeSegment(), and the joined result goes through resolveInside() so
 * it can never land outside the environment root.
 */

import path from "path";

/**
 * Validate a single path segment: an environment name, filename, capsule
 * path, draft name, stream ID, or crate name. Rejects empty values, "."
 * and "..", "/" and "\", NUL, and anything absolute (including Windows
 * drive prefixes like "C:"). Returns the value unchanged when safe.
 */
export function safeSegment(value, label) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Invalid ${label}: must be a non-empty string`);
    }
    if (value === "." || value === "..") {
        throw new Error(`Invalid ${label}: "${value}" is not allowed`);
    }
    if (value.includes("\0")) {
        throw new Error(`Invalid ${label}: NUL bytes are not allowed`);
    }
    if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
        throw new Error(`Invalid ${label}: absolute paths are not allowed`);
    }
    if (value.includes("/") || value.includes("\\")) {
        throw new Error(`Invalid ${label}: path separators are not allowed`);
    }
    return value;
}

/**
 * Join `segments` onto `root`, resolve, and assert the result is still
 * inside `root`. Defense in depth behind safeSegment(). Returns the
 * resolved absolute path.
 */
export function resolveInside(root, ...segments) {
    const base = path.resolve(root);
    const target = path.resolve(base, ...segments);
    const relative = path.relative(base, target);

    if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
    ) {
        throw new Error("Invalid path: resolves outside the environment root");
    }

    return target;
}
