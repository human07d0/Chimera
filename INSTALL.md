# Chimera 安装手册

## 快速安装（Bun）

### Linux / macOS

```bash
# 1. 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 2. 下载并解压
mkdir -p ~/chimera && cd ~/chimera
curl -L -o chimera-bun.zip https://github.com/Yevpatoria/Chimera/releases/latest/download/chimera-bun.zip
unzip chimera-bun.zip && rm chimera-bun.zip

# 3. 配置并启动
cp .env.example .env
# 编辑 .env 填入 MIMO_API_KEY
bun run index.js
```

### Windows

```powershell
# 1. 安装 Bun
irm bun.sh/install | iex

# 2. 下载并解压
mkdir $env:USERPROFILE\chimera; cd $env:USERPROFILE\chimera
Invoke-WebRequest -Uri "https://github.com/Yevpatoria/Chimera/releases/latest/download/chimera-bun.zip" -OutFile chimera-bun.zip
Expand-Archive chimera-bun.zip -Force
Remove-Item chimera-bun.zip

# 3. 配置并启动
copy .env.example .env
# 编辑 .env 填入 MIMO_API_KEY
bun run index.js
```

### Android (Termux)

```bash
# 1. 安装依赖
pkg update && pkg install curl unzip

# 2. 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 3. 下载并解压
mkdir -p ~/chimera && cd ~/chimera
curl -L -o chimera-bun.zip https://github.com/Yevpatoria/Chimera/releases/latest/download/chimera-bun.zip
unzip chimera-bun.zip && rm chimera-bun.zip

# 4. 配置并启动
cp .env.example .env
# 编辑 .env 填入 MIMO_API_KEY
bun run index.js
```

默认服务地址：`http://localhost:3000`

---

## 源码安装

### 依赖

- Node.js >= 24 LTS
- pnpm 10.x
- Git

### 步骤

```bash
# 1. 克隆项目
git clone https://github.com/Yevpatoria/Chimera.git
cd Chimera

# 2. 安装依赖
pnpm install

# 3. 配置
cp .env.example .env
# 编辑 .env 填入 MIMO_API_KEY

# 4. 构建
pnpm run build

# 5. 启动
node dist/index.js
```

---

---

## 后台运行

### Linux (systemd)

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
ExecStart=/root/.bun/bin/bun run index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chimera
```

### Linux (tmux)

```bash
tmux new -s mimo
bun run index.js
# Ctrl+B 松开再按 D 退出
```

### Windows (nssm)

下载 nssm，以管理员运行：
```cmd
nssm install chimera "C:\Users\<用户>\.bun\bin\bun.exe" "run index.js"
nssm start chimera
```

---

## 更新

```bash
# Bun 安装
cd ~/chimera
curl -L -o chimera-bun.zip https://github.com/Yevpatoria/Chimera/releases/latest/download/chimera-bun.zip
unzip -o chimera-bun.zip && rm chimera-bun.zip

# 源码
git pull && pnpm install && pnpm run build
```

---

## 卸载

```bash
# Bun/源码
pkill chimera  # 或停止 systemd 服务
rm -rf ~/chimera
```
