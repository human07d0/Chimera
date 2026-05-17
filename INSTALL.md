# Chimera 安装手册

## 方式一：npm 安装（推荐）

**前提：Node.js >= 24**

```bash
npm install -g chimeraproxy
```

配置环境变量：

```bash
cp .env.example .env
# 编辑 .env 填入必要的配置
```

启动：

```bash
chimera
```

---

## 方式二：下载 zip

下载地址：https://github.com/Yevpatoria/Chimera/releases/latest/download/chimera.zip

zip 包含以下文件：
- `index.js` — Bun 单文件打包
- `ops/` — Web 管理界面
- `config/` — 提供商配置模板
- `.env.example` — 环境变量示例
- `start.sh` — Linux / macOS / Termux 启动脚本
- `start.cmd` — Windows 启动脚本

启动脚本会自动检测并安装 Bun（如未安装）。

### Linux / macOS / Termux

```bash
# 下载
curl -L -o chimera.zip https://github.com/Yevpatoria/Chimera/releases/latest/download/chimera.zip

# 解压
unzip chimera.zip && rm chimera.zip

# 配置
cp .env.example .env
# 编辑 .env 填入必要的配置

# 启动（自动安装 Bun）
./start.sh
```

### Windows

```powershell
# 下载
Invoke-WebRequest -Uri "https://github.com/Yevpatoria/Chimera/releases/latest/download/chimera.zip" -OutFile chimera.zip

# 解压
Expand-Archive chimera.zip -Force
Remove-Item chimera.zip

# 配置
copy .env.example .env
# 编辑 .env 填入必要的配置
```

双击 `start.cmd` 启动（自动安装 Bun）。

默认服务地址：`http://localhost:3000`

---

## 源码安装

**依赖：** Node.js >= 24、pnpm 10.x、Git

```bash
git clone https://github.com/Yevpatoria/Chimera.git
cd Chimera
pnpm install
cp .env.example .env
# 编辑 .env 填入必要的配置
pnpm run build
node dist/index.js
```

---

## 后台运行

### Linux（systemd）

```bash
sudo nano /etc/systemd/system/chimera.service
```

写入：

```ini
[Unit]
Description=Chimera

[Service]
Type=simple
User=<用户名>
WorkingDirectory=/path/to/chimera
ExecStart=/usr/bin/env chimera
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chimera
```

### Linux（tmux）

```bash
tmux new -s chimera
chimera
# Ctrl+B 松开再按 D 退出
```

### Windows（nssm）

下载 nssm，以管理员运行：

```cmd
nssm install chimera chimera
nssm start chimera
```

---

## 更新

```bash
# npm
npm update -g chimeraproxy

# zip
# 重新下载解压，覆盖原有文件

# 源码
git pull && pnpm install && pnpm run build
```

---

## 卸载

```bash
# npm
npm uninstall -g chimeraproxy

# zip / 源码
rm -rf ~/chimera
```
