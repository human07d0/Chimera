import { describe, it, expect } from "vitest";
import {
  CONFIG_FIELDS,
  KEY_ALIASES,
  getFieldDef,
  generateSchema,
} from "../configSchema";

describe("configSchema", () => {
  describe("CONFIG_FIELDS", () => {
    it("should have 15 fields", () => {
      expect(CONFIG_FIELDS).toHaveLength(15);
    });

    it("should have unique envKeys", () => {
      const keys = CONFIG_FIELDS.map((f) => f.envKey);
      expect(new Set(keys).size).toBe(15);
    });

    it("should have unique aliases", () => {
      const aliases = CONFIG_FIELDS.map((f) => f.alias);
      expect(new Set(aliases).size).toBe(15);
    });

    it("each field should have required properties", () => {
      for (const field of CONFIG_FIELDS) {
        expect(field.envKey).toBeTruthy();
        expect(field.alias).toBeTruthy();
        expect(["string", "number", "boolean"]).toContain(field.type);
        expect(field.description).toBeTruthy();
      }
    });
  });

  describe("LOG_LEVEL field", () => {
    it("should have correct definition", () => {
      const field = getFieldDef("LOG_LEVEL");
      expect(field).toBeDefined();
      expect(field!.alias).toBe("logLevel");
      expect(field!.type).toBe("string");
      expect(field!.enum).toEqual(["error", "warn", "info", "debug"]);
      expect(field!.description).toBe("日志级别");
    });
  });

  describe("WEB_SEARCH_MAX_KEYWORD field", () => {
    it("should have correct definition", () => {
      const field = getFieldDef("WEB_SEARCH_MAX_KEYWORD");
      expect(field).toBeDefined();
      expect(field!.alias).toBe("webSearchMaxKeyword");
      expect(field!.type).toBe("number");
      expect(field!.min).toBe(1);
    });
  });

  describe("WEB_SEARCH_FORCE_SEARCH field", () => {
    it("should be boolean type", () => {
      const field = getFieldDef("WEB_SEARCH_FORCE_SEARCH");
      expect(field).toBeDefined();
      expect(field!.type).toBe("boolean");
      expect(field!.enum).toBeUndefined();
      expect(field!.min).toBeUndefined();
    });
  });

  describe("MONITOR_FLUSH_INTERVAL_MS field", () => {
    it("should have min 50", () => {
      const field = getFieldDef("MONITOR_FLUSH_INTERVAL_MS");
      expect(field).toBeDefined();
      expect(field!.min).toBe(50);
    });
  });

  describe("UPSTREAM_TIMEOUT_MS field", () => {
    it("should have min 1000", () => {
      const field = getFieldDef("UPSTREAM_TIMEOUT_MS");
      expect(field).toBeDefined();
      expect(field!.min).toBe(1000);
    });
  });

  describe("DEBUG_MAX_BODY_SIZE field", () => {
    it("should have min 1024", () => {
      const field = getFieldDef("DEBUG_MAX_BODY_SIZE");
      expect(field).toBeDefined();
      expect(field!.min).toBe(1024);
    });
  });

  describe("DEBUG_MAX_MEDIA_BYTES field", () => {
    it("should have min 1024", () => {
      const field = getFieldDef("DEBUG_MAX_MEDIA_BYTES");
      expect(field).toBeDefined();
      expect(field!.min).toBe(1024);
    });
  });

  describe("getFieldDef", () => {
    it("should return undefined for unknown key", () => {
      expect(getFieldDef("UNKNOWN_KEY")).toBeUndefined();
    });
  });

  describe("KEY_ALIASES", () => {
    it("should map alias to envKey for all fields", () => {
      for (const field of CONFIG_FIELDS) {
        expect(KEY_ALIASES[field.alias]).toBe(field.envKey);
      }
    });

    it("should have 15 entries", () => {
      expect(Object.keys(KEY_ALIASES)).toHaveLength(15);
    });
  });

  describe("generateSchema", () => {
    it("should produce schema matching the hardcoded original", () => {
      const schema = generateSchema();

      const expected = {
        logLevel: {
          key: "LOG_LEVEL",
          type: "string",
          enum: ["error", "warn", "info", "debug"],
          description: "日志级别",
        },
        webSearchMaxKeyword: {
          key: "WEB_SEARCH_MAX_KEYWORD",
          type: "number",
          min: 1,
          description: "联网搜索最大关键词数量",
        },
        webSearchForceSearch: {
          key: "WEB_SEARCH_FORCE_SEARCH",
          type: "boolean",
          description: "是否强制开启联网搜索能力",
        },
        webSearchLimit: {
          key: "WEB_SEARCH_LIMIT",
          type: "number",
          min: 1,
          description: "每次搜索返回的网页数量",
        },
        webSearchCountry: {
          key: "WEB_SEARCH_COUNTRY",
          type: "string",
          description: "搜索地理位置 - 国家",
        },
        webSearchRegion: {
          key: "WEB_SEARCH_REGION",
          type: "string",
          description: "搜索地理位置 - 省份/地区",
        },
        webSearchCity: {
          key: "WEB_SEARCH_CITY",
          type: "string",
          description: "搜索地理位置 - 城市",
        },
        monitorFlushIntervalMs: {
          key: "MONITOR_FLUSH_INTERVAL_MS",
          type: "number",
          min: 50,
          description: "监控异步写入队列的刷新间隔（毫秒）",
        },
        monitorRetentionDays: {
          key: "MONITOR_RETENTION_DAYS",
          type: "number",
          min: 1,
          description: "监控数据保留天数",
        },
        monitorFlushBatchSize: {
          key: "MONITOR_FLUSH_BATCH_SIZE",
          type: "number",
          min: 1,
          description: "监控异步写入批量大小",
        },
        monitorQueueMaxSize: {
          key: "MONITOR_QUEUE_MAX_SIZE",
          type: "number",
          min: 1,
          description: "监控异步队列最大长度",
        },
        upstreamTimeoutMs: {
          key: "UPSTREAM_TIMEOUT_MS",
          type: "number",
          min: 1000,
          description: "上游请求超时时间（毫秒），同时应用于主代理和 token-plan",
        },
        debugMaxRecords: {
          key: "DEBUG_MAX_RECORDS",
          type: "number",
          min: 1,
          description: "调试记录最大条数（环形缓冲区容量）",
        },
        debugMaxBodySize: {
          key: "DEBUG_MAX_BODY_SIZE",
          type: "number",
          min: 1024,
          description: "调试记录单条请求/响应体最大字节数",
        },
        debugMaxMediaBytes: {
          key: "DEBUG_MAX_MEDIA_BYTES",
          type: "number",
          min: 1024,
          description: "调试模式媒体资源缓存最大字节数",
        },
      };

      expect(schema).toEqual(expected);
    });

    it("should have 15 entries", () => {
      const schema = generateSchema();
      expect(Object.keys(schema)).toHaveLength(15);
    });

    it("each entry should have key, type, description", () => {
      const schema = generateSchema();
      for (const [alias, entry] of Object.entries(schema)) {
        expect(entry.key).toBeTruthy();
        expect(entry.type).toBeTruthy();
        expect(entry.description).toBeTruthy();
      }
    });
  });
});
