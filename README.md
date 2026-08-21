# 狼人杀发言记录器

一个手机优先的轻量发言记录页面，保留席位、警上、天数、阶段、手动补记、语音转文字和导入导出。

分享链接：

```text
https://cmeng228.github.io/werewolf-speech-recorder/
```

## 本地运行

```powershell
& "C:\Users\cob\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools/server.mjs
```

打开：

```text
http://127.0.0.1:5186
```

## 语音转文字

公开网页使用浏览器自带的语音识别能力，Chrome 和 Edge 支持度最好。浏览器只能读取已授权的麦克风输入；如果要记录手机里网易狼人杀的声音，需要把手机声音路由到电脑或浏览器当前可用的麦克风输入。

如果手机一直提示麦克风未授权：

- 用 Chrome、Edge 或手机自带浏览器打开，不建议用微信、QQ、飞书等内置浏览器。
- 在浏览器地址栏权限里允许麦克风；如果之前点过拒绝，需要到系统设置里给浏览器打开麦克风权限。
- 保持记录器页面在前台。手机浏览器不能在后台直接读取另一个 App 的内部声音。
