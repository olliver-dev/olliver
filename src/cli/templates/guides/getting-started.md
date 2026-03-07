# Getting Started

## 1. Install Olliver

```bash
npm install -g olliver
```

## 2. Set Up Your Shelf

```bash
olli install
```

This creates the `.olli/` Container with your first Environment. The installer walks you through:
- Choosing a Shelf location
- Naming your Environment

## 3. Configure Your AI Client

```bash
olli client
```

Select your AI client from the menu and follow the setup guide. The core configuration is the same for all clients: add Olliver as an MCP server.

The server needs one thing: the path to `src/index.js` in your global Olliver install:

```bash
npm root -g
# → /usr/local/lib/node_modules
# Server path: /usr/local/lib/node_modules/olliver/src/index.js
```

A single server entry handles all Environments — no per-Environment configuration needed.

## 4. Start a Conversation

Open your AI client and try these:

- "What capsules do I have?" — lists your Shelf
- "Run a health check" — shows system state
- "Help me get started with Olliver" — the agent can read the built-in guides

## 5. Build Your Knowledge Base

As you work, extract durable context into Capsules:

- "Extract what we decided about the architecture into a spec capsule"
- "Let me drop some reference docs in receiving — scan them when I'm ready"
- "Mount the product definition so we have context for this conversation"

Your knowledge base grows organically through natural conversation. Every Capsule you create is available to any MCP-compatible AI client.
