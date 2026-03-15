import { logger } from "../utils/logger";

// 监控数据接口
export interface CallRecord {
  id: string;
  timestamp: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedPromptTokens: number;
  cost: number;
  duration: number;
}

// 内存存储
const callRecords: CallRecord[] = [];
const MAX_RECORDS = 10000; // 最多保留10000条记录

// 生成唯一ID
function generateId(): string {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 添加调用记录
export function addCallRecord(record: Omit<CallRecord, "id" | "timestamp">): void {
  const newRecord: CallRecord = {
    ...record,
    id: generateId(),
    timestamp: new Date(),
  };

  callRecords.push(newRecord);

  // 如果超过最大数量，删除最旧的记录
  if (callRecords.length > MAX_RECORDS) {
    callRecords.shift();
  }

  logger.debug("Call record added", {
    id: newRecord.id,
    model: newRecord.model,
    cost: newRecord.cost,
  });
}

// 获取3天内的调用记录
export function getRecentCalls(days: number = 3): CallRecord[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return callRecords.filter((record) => record.timestamp >= cutoffDate);
}

// 获取调用统计
export function getCallStats(days: number = 3) {
  const recentCalls = getRecentCalls(days);
  
  const totalCalls = recentCalls.length;
  const totalInputTokens = recentCalls.reduce((sum, call) => sum + call.inputTokens, 0);
  const totalOutputTokens = recentCalls.reduce((sum, call) => sum + call.outputTokens, 0);
  const totalCachedPromptTokens = recentCalls.reduce((sum, call) => sum + call.cachedPromptTokens, 0);
  const totalCost = recentCalls.reduce((sum, call) => sum + call.cost, 0);

  return {
    totalCalls,
    totalInputTokens,
    totalOutputTokens,
    totalCachedPromptTokens,
    totalCost,
  };
}

// 清理旧记录（可选，可以定期调用）
export function cleanupOldRecords(days: number = 7): void {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const initialLength = callRecords.length;
  const filteredRecords = callRecords.filter((record) => record.timestamp >= cutoffDate);
  
  if (filteredRecords.length < callRecords.length) {
    callRecords.length = 0;
    callRecords.push(...filteredRecords);
    logger.info(`Cleaned up ${initialLength - filteredRecords.length} old call records`);
  }
}