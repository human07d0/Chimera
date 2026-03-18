import { config } from "../../config";
import { logger } from "../../utils/logger";
import { MonitorStorage, memoryStorage } from ".";
import { SqliteStorage } from "./sqlite";
import { storageWorker } from "./worker";

let storageInstance: MonitorStorage | null = null;

function isLikelySqliteNativeBindingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Could not locate the bindings file") ||
    message.includes("node_sqlite3.node") ||
    message.includes("sqlite3")
  );
}

export async function getStorage(): Promise<MonitorStorage> {
  if (storageInstance) {
    return storageInstance;
  }

  const { storage, sqlitePath } = config.monitor;

  if (storage === "sqlite") {
    try {
      logger.info(`Using SQLite storage: ${sqlitePath}`);
      const sqliteStorage = new SqliteStorage(sqlitePath);
      await sqliteStorage.init();
      storageInstance = sqliteStorage;
      logger.info("SQLite storage ready");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to initialize SQLite monitor storage, falling back to memory", {
        sqlitePath,
        error: errorMessage,
      });

      if (isLikelySqliteNativeBindingError(error)) {
        logger.error("SQLite native binding seems missing. Please run `pnpm rebuild sqlite3`.", {
          hint: "Ensure pnpm-workspace.yaml has allowBuilds.sqlite3=true",
        });
      }

      storageInstance = memoryStorage;
      logger.warn("Monitor storage fallback activated: memory");
    }
  } else {
    logger.info("Using memory storage");
    storageInstance = memoryStorage;
  }

  storageWorker.setStorage(storageInstance);
  return storageInstance;
}

export async function closeStorage(): Promise<void> {
  if (storageInstance) {
    await storageInstance.close();
    storageInstance = null;
  }
}


