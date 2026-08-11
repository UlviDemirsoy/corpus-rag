import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { applyMigrations } from "../../infrastructure/db/migrate.js";
import { createContainer } from "../../composition/container.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { createCorpusSearchServer } from "./createCorpusSearchServer.js";

async function main() {
  await applyMigrations();
  const container = createContainer();
  const server = createCorpusSearchServer(container);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP search server started (stdio)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
