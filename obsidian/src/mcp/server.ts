import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools, type ServerCtx } from "./tools.js";

export function buildMcpServer(ctx: ServerCtx): McpServer {
  const server = new McpServer({ name: "vault-skills", version: ctx.pluginVersion });
  registerTools(server, ctx);
  return server;
}

export type { ServerCtx };
