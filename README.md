# Codex Remote Relay on Zeabur

这个目录可以直接作为 Zeabur Node.js 服务部署，用于让 Android App 在移动网络下访问 PC 上的 Codex Bridge。

## 架构

```text
Android App
  -> https://<your-zeabur-domain>
  -> Zeabur Relay
  -> wss://<your-zeabur-domain>/bridge
  -> PC Bridge
  -> Codex app-server
```

## Zeabur 环境变量

必须设置：

```text
CODEX_REMOTE_RELAY_TOKEN=<高强度随机Token>
```

可选：

```text
CODEX_REMOTE_RELAY_PORT=8788
```

Zeabur 通常会自动注入 `PORT`，Relay 会优先使用 `PORT`。

## Zeabur 启动命令

如果 Zeabur 没有自动识别，请手动设置：

```bash
npm install
npm run start:relay
```

## PC Bridge 连接 Zeabur Relay

把下面的域名和 token 换成你 Zeabur 的真实值：

```powershell
$env:CODEX_REMOTE_RELAY_URL='wss://<your-zeabur-domain>/bridge'
$env:CODEX_REMOTE_RELAY_TOKEN='<高强度随机Token>'
node desktop-bridge-poc/server.js
```

PC Bridge 启动后会主动连 Relay，所以 PC 不需要公网 IP，也不需要端口映射。

## Android App 配置

手机移动网络下：

```text
桥接地址: https://<your-zeabur-domain>
Relay Token: <高强度随机Token>
```

## 验收

在 PC 上验证 Relay 公网可用：

```powershell
Invoke-RestMethod -Headers @{Authorization='Bearer <高强度随机Token>'} https://<your-zeabur-domain>/health
Invoke-RestMethod -Headers @{Authorization='Bearer <高强度随机Token>'} https://<your-zeabur-domain>/sessions
```

应看到：

```json
{
  "bridgeOnline": true
}
```

发送测试消息：

```powershell
Invoke-RestMethod -Method Post `
  -Headers @{Authorization='Bearer <高强度随机Token>'} `
  -Uri https://<your-zeabur-domain>/messages `
  -ContentType 'application/json; charset=utf-8' `
  -Body '{"text":"只回复 RELAY_PONG，不要做其他事。"}'
```

然后查看：

```powershell
Invoke-RestMethod -Headers @{Authorization='Bearer <高强度随机Token>'} https://<your-zeabur-domain>/events/history
```

应包含：

```text
RELAY_PONG
```
