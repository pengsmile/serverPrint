# PrintHelper 打印服务

## 简介
基于 Electron 的 Windows 本地打印服务，通过 Socket.io 接收 HTML 并执行打印，可在托盘常驻运行。

## 功能
- 接收 HTML 内容并打印到指定打印机
- 查询本机打印机列表与默认打印机
- 托盘常驻与日志查看
- 登录后自动启动（非系统服务）

## 运行环境
- Windows
- Node.js（开发/调试）

## 项目结构
- [src/index.js](file:///d:/project/serverPrint/src/index.js)：应用入口、托盘、自动启动、HTTP/Socket 服务启动
- [src/server.js](file:///d:/project/serverPrint/src/server.js)：Socket.io 通信与事件处理
- [src/printer.js](file:///d:/project/serverPrint/src/printer.js)：打印、查询打印机、打印机状态
- [src/logger.js](file:///d:/project/serverPrint/src/logger.js)：日志配置
- [src/renderer/tray.html](file:///d:/project/serverPrint/src/renderer)：托盘窗口界面
- [test.html](file:///d:/project/serverPrint/test.html)：本地测试页面
- [assets](file:///d:/project/serverPrint/assets)：应用图标资源

## 安装依赖

```bash
npm install
```

## 开发运行

```bash
npm run dev
```

启动后会监听 Socket.io 服务端口 `18765`（可通过 `.env` 环境变量覆盖）。

## 打包

```bash
npm run build:test
npm run build:prod
```
环境变量对应 .env.test  .env.production

打包配置在 [package.json](file:///d:/project/serverPrint/package.json) 的 `build` 字段中。

## 通信协议（Socket.io）
连接到 `http://localhost:8765`，主要事件：
- `printers`：获取打印机列表
- `status`：获取服务状态
- `print`：发送打印任务

打印请求示例（客户端发送）：

```json
{
  "html": "<div>hello</div>",
  "printer": "Printer Name",
  "copies": 1
}
```

返回示例：

```json
{
  "success": true,
  "message": "Print job sent successfully",
  "jobId": "1700000000000"
}
```

## 自动启动
登录后自动启动逻辑在 [index.js](file:///d:/project/serverPrint/src/index.js#L120-L150)，使用 `app.setLoginItemSettings` 设置。


## 日志
日志默认写入用户目录下的 `logs/main.log`，并按大小滚动（5MB）。

## 说明
本项目仅在 Windows 环境下进行打印适配，打印行为依赖本机打印驱动与系统打印服务。
