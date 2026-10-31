import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./db.js";

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Placement API started");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down Placement API");
  server.close(async (error) => {
    if (error) {
      logger.error({ err: error }, "HTTP server shutdown failed");
      process.exitCode = 1;
    }

    await prisma.$disconnect();
    process.exit();
  });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
