import { config } from "../../config";
import { logger } from "../../utils/logger";
import { MonitorStorage, memoryStorage } from ".";
import { SqliteStorage } from "./sqlite";
import { storageWorker } from "./worker";

let storageInstance: MonitorStorage | null = null;
let initializationPromise: Promise<MonitorStorage> | null = null;

export async function getStorageAsync(): Promise<MonitorStorage> {
  if (storageInstance) {
    return storageInstance;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  const { storage, sqlitePath } = config.monitor;

  if (storage === "sqlite") {
    initializationPromise = (async () => {
      try {
        logger.info(`Using SQLite storage: ${sqlitePath}`);
        await SqliteStorage.initSqlModule();
        const sqliteStorage = new SqliteStorage(sqlitePath);
        sqliteStorage.init();
        storageInstance = sqliteStorage;
        logger.info("SQLite storage ready");
        storageWorker.setStorage(storageInstance);
        return storageInstance;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Failed to initialize SQLite monitor storage, falling back to memory", {
          sqlitePath,
          error: errorMessage,
        });

        storageInstance = memoryStorage;
        logger.warn("Monitor storage fallback activated: memory");
        storageWorker.setStorage(storageInstance);
        return storageInstance;
      }
    })();

    return initializationPromise;
  } else {
    logger.info("Using memory storage");
    storageInstance = memoryStorage;
    storageWorker.setStorage(storageInstance);
    return storageInstance;
  }
}

// 为了保持向后兼容，提供一个同步版本，但会在后台初始化
export function getStorage(): MonitorStorage {
  if (storageInstance) {
    return storageInstance;
  }

  void getStorageAsync();

  return memoryStorage;
}

export function closeStorage(): void {
  if (storageInstance) {
    storageInstance.close();
    storageInstance = null;
  }
  initializationPromise = null;
}
