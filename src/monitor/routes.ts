import { Request, Response, Router } from "express";
import { getRecentCalls, getCallStats } from "./storage";

// 创建监控路由 - 添加类型注解以解决编译错误
export const monitorRouter: Router = Router();

// /monitor 重定向到 /
monitorRouter.get("/", (req: Request, res: Response) => {
  res.redirect('/');
});

// 获取监控统计数据
monitorRouter.get("/stats", (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 3;
    const stats = getCallStats(days);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "获取统计数据失败"
    });
  }
});

// 获取调用详情
monitorRouter.get("/calls", (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 3;
    const calls = getRecentCalls(days);
    
    res.json({
      success: true,
      data: calls
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "获取调用详情失败"
    });
  }
});
