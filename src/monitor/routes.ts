import { Request, Response, Router } from "express";
import { getRecentCalls, getCallStats } from "./storage";

// 创建监控路由 - 添加类型注解以解决编译错误
export const monitorRouter: Router = Router();

// 获取监控首页（HTML）
monitorRouter.get("/", (req: Request, res: Response) => {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API 调用监控</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .stat-card h3 {
            margin: 0 0 10px 0;
            color: #666;
            font-size: 14px;
        }
        .stat-card .value {
            font-size: 24px;
            font-weight: bold;
            color: #333;
        }
        .stat-card .unit {
            font-size: 14px;
            color: #999;
        }
        .table-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #333;
        }
        tr:hover {
            background-color: #f8f9fa;
        }
        .refresh-btn {
            background-color: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-bottom: 20px;
        }
        .refresh-btn:hover {
            background-color: #0056b3;
        }
        .loading {
            text-align: center;
            padding: 20px;
            color: #666;
        }
        .error {
            color: #dc3545;
            padding: 20px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>API 调用监控</h1>
        <button class="refresh-btn" onclick="loadData()">刷新数据</button>
        
        <div id="stats" class="stats-grid">
            <div class="stat-card">
                <h3>总调用次数</h3>
                <div class="value" id="totalCalls">-</div>
            </div>
            <div class="stat-card">
                <h3>总成本</h3>
                <div class="value" id="totalCost">-</div>
                <span class="unit">元</span>
            </div>
            <div class="stat-card">
                <h3>总输入 Tokens</h3>
                <div class="value" id="totalInputTokens">-</div>
            </div>
            <div class="stat-card">
                <h3>总缓存命中 Tokens</h3>
                <div class="value" id="totalCachedTokens">-</div>
            </div>
            <div class="stat-card">
                <h3>总输出 Tokens</h3>
                <div class="value" id="totalOutputTokens">-</div>
            </div>
        </div>

        <h2>调用详情</h2>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>时间</th>
                        <th>模型</th>
                        <th>输入 Tokens</th>
                        <th>缓存命中</th>
                        <th>输出 Tokens</th>
                        <th>成本 (元)</th>
                        <th>耗时 (ms)</th>
                    </tr>
                </thead>
                <tbody id="callsTable">
                    <tr><td colspan="7" class="loading">加载中...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <script>
        async function loadData() {
            try {
                // 加载统计数据
                const statsResponse = await fetch('/monitor/stats?days=3');
                const statsData = await statsResponse.json();
                
                if (statsData.success) {
                    const stats = statsData.data;
                    document.getElementById('totalCalls').textContent = stats.totalCalls;
                    document.getElementById('totalCost').textContent = stats.totalCost.toFixed(4);
                    document.getElementById('totalInputTokens').textContent = stats.totalInputTokens.toLocaleString();
                    document.getElementById('totalCachedTokens').textContent = stats.totalCachedPromptTokens.toLocaleString();
                    document.getElementById('totalOutputTokens').textContent = stats.totalOutputTokens.toLocaleString();
                }

                // 加载调用详情
                const callsResponse = await fetch('/monitor/calls?days=3');
                const callsData = await callsResponse.json();
                
                if (callsData.success) {
                    const calls = callsData.data;
                    const tbody = document.getElementById('callsTable');
                    
                    if (calls.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="7" class="loading">暂无数据</td></tr>';
                        return;
                    }
                    
                    // 按时间倒序排列
                    calls.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    
                    tbody.innerHTML = calls.map(call => {
                        return '<tr>' +
                            '<td>' + new Date(call.timestamp).toLocaleString('zh-CN') + '</td>' +
                            '<td>' + call.model + '</td>' +
                            '<td>' + call.inputTokens.toLocaleString() + '</td>' +
                            '<td>' + call.cachedPromptTokens.toLocaleString() + '</td>' +
                            '<td>' + call.outputTokens.toLocaleString() + '</td>' +
                            '<td>' + call.cost.toFixed(4) + '</td>' +
                            '<td>' + call.duration + '</td>' +
                        '</tr>';
                    }).join('');
                }
            } catch (error) {
                console.error('加载数据失败:', error);
                document.getElementById('callsTable').innerHTML = 
                    '<tr><td colspan="7" class="error">加载数据失败，请稍后重试</td></tr>';
            }
        }

        // 页面加载时自动加载数据
        loadData();
        // 每30秒自动刷新
        setInterval(loadData, 30000);
    </script>
</body>
</html>
  `;
  res.send(html);
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
