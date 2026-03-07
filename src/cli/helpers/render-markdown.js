/**
 * Lightweight terminal markdown renderer.
 *
 * Zero dependencies — uses ANSI escape codes directly.
 * Handles: headers, bold, italic, inline code, fenced code blocks,
 * blockquotes, unordered/ordered lists, tables, links.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

/**
 * Apply inline formatting: bold, italic, inline code, links
 */
function inlineFormat(line) {
    return line
        .replace(/`([^`]+)`/g, `${CYAN}$1${RESET}`)
        .replace(/\*\*([^*]+)\*\*/g, `${BOLD}$1${RESET}`)
        .replace(/\*([^*]+)\*/g, `${ITALIC}$1${RESET}`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `$1 ${CYAN}($2)${RESET}`);
}

/**
 * Render a pipe-delimited markdown table as aligned columns
 */
function renderTable(rows) {
    // Parse cells from each row
    const parsed = rows.map((row) =>
        row
            .split("|")
            .slice(1, -1)
            .map((cell) => cell.trim()),
    );

    // Drop the separator row (|---|---|)
    const dataRows = parsed.filter(
        (cells) => !cells.every((c) => /^[-:]+$/.test(c)),
    );

    if (dataRows.length === 0) return "";

    // Calculate column widths
    const colCount = dataRows[0].length;
    const widths = Array(colCount).fill(0);
    for (const cells of dataRows) {
        for (let i = 0; i < cells.length; i++) {
            if (cells[i].length > widths[i]) {
                widths[i] = cells[i].length;
            }
        }
    }

    const lines = [];
    for (let r = 0; r < dataRows.length; r++) {
        const cells = dataRows[r];
        const formatted = cells.map((cell, i) =>
            inlineFormat(cell.padEnd(widths[i])),
        );
        const line = "  " + formatted.join("   ");
        // Bold the header row
        lines.push(r === 0 ? `${BOLD}${line}${RESET}` : line);
        // Underline after header
        if (r === 0) {
            const rule = widths.map((w) => "─".repeat(w)).join("───");
            lines.push(`  ${DIM}${rule}${RESET}`);
        }
    }

    return lines.join("\n");
}

/**
 * Render markdown text for terminal output
 */
export default function renderMarkdown(text) {
    const lines = text.split("\n");
    const output = [];
    let inCodeBlock = false;
    let tableBuffer = [];

    function flushTable() {
        if (tableBuffer.length > 0) {
            output.push(renderTable(tableBuffer));
            tableBuffer = [];
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Fenced code blocks
        if (line.startsWith("```")) {
            flushTable();
            if (!inCodeBlock) {
                inCodeBlock = true;
                output.push("");
            } else {
                inCodeBlock = false;
                output.push("");
            }
            continue;
        }

        if (inCodeBlock) {
            output.push(`    ${DIM}${line}${RESET}`);
            continue;
        }

        // Table rows
        if (line.trimStart().startsWith("|") && line.trimEnd().endsWith("|")) {
            tableBuffer.push(line);
            continue;
        } else {
            flushTable();
        }

        // Headers
        if (line.startsWith("### ")) {
            output.push(`${BOLD}${UNDERLINE}${line.slice(4)}${RESET}`);
            continue;
        }
        if (line.startsWith("## ")) {
            output.push(`\n${BOLD}${CYAN}${line.slice(3)}${RESET}\n`);
            continue;
        }
        if (line.startsWith("# ")) {
            output.push(`\n${BOLD}${YELLOW}${line.slice(2)}${RESET}\n`);
            continue;
        }

        // Horizontal rules
        if (/^-{3,}$/.test(line.trim())) {
            output.push(`${DIM}${"─".repeat(60)}${RESET}`);
            continue;
        }

        // Blockquotes
        if (line.startsWith("> ")) {
            output.push(`  ${DIM}│${RESET} ${ITALIC}${inlineFormat(line.slice(2))}${RESET}`);
            continue;
        }

        // Unordered lists
        if (/^(\s*)- (.*)/.test(line)) {
            const match = line.match(/^(\s*)- (.*)/);
            const indent = match[1].length;
            const content = match[2];
            output.push(`${"  ".repeat(indent / 2 + 1)}• ${inlineFormat(content)}`);
            continue;
        }

        // Ordered lists
        if (/^(\s*)\d+\. (.*)/.test(line)) {
            const match = line.match(/^(\s*)(\d+)\. (.*)/);
            const indent = match[1].length;
            const num = match[2];
            const content = match[3];
            output.push(`${"  ".repeat(indent / 2 + 1)}${num}. ${inlineFormat(content)}`);
            continue;
        }

        // Regular text or blank lines
        output.push(inlineFormat(line));
    }

    flushTable();
    return output.join("\n");
}
