# 狼人杀发言记牌器

本地运行的发言记录工具，支持板型切换、席位、警上阶段、天数、阶段、玩家身份标记、玩家备注、手动补记、浏览器听写、可选音频输入源转写、JSON/Markdown 导入导出。

## 启动

```powershell
& "C:\Users\cob\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools/server.mjs
```

打开：

```text
http://127.0.0.1:5186
```

## 转写方式

1. 浏览器听写：适合先试用。Chrome/Edge 支持度最好，识别用系统默认麦克风。
2. 指定输入源：需要先设置 `OPENAI_API_KEY`，然后勾选“指定输入源”。这一路可以选择电脑看到的音频输入设备，例如手机蓝牙麦克风、声卡输入、VB-Cable、Stereo Mix。

示例：

```powershell
$env:OPENAI_API_KEY="你的密钥"
& "C:\Users\cob\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" tools/server.mjs
```

安卓/iOS 不允许普通第三方工具在后台直接读取另一个 APP 的内部音频。要记录网易狼人杀 APP 的声音，需要把手机声音路由到电脑输入源，或后续做 Android 原生版并走系统录屏/无障碍授权。

## 板型配置

当前板型来自：

```text
E:\网页下载\板子配置 (2).xlsx
```

已提取为：

```text
boards-config.json
```

如果换了新的板子表，可以重新生成：

```powershell
& "C:\Users\cob\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" tools\extract_boards.py "E:\网页下载\板子配置 (2).xlsx" boards-config.json
```
