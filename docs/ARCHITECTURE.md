# 架构与运行时契约

## 分层

```text
Web 宿主 / Demo / JAR URL
          │
          ▼
runtime-api.js
          │
          ▼
runtime-controller.js
          │
          ▼
Emscripten MEMFS / 可选 IDBFS
          │
          ▼
miniJVM.wasm ─ WebLauncher ─ freej2meOnMinijvm
                                  │
                                  ▼
                           FreeJ2ME Plus / MIDlet
                         ┌──────┴──────┐
                         ▼             ▼
                   Canvas/WebGL2      Web Audio
```

## 代码边界

- `web/runtime-api.js` 是宿主公共入口，负责配置校验、内容加载、Wasm 初始化、输入、音频、缩放和存储适配。
- `web/runtime-controller.js` 管理生命周期、事件和宿主操作串行化。
- `web/checkpoint-codec.js` 是 RMS checkpoint 的唯一编解码实现。
- `web/compatibility-profiles.js` 以 JAR SHA-256 选择兼容策略，不依赖文件名。
- `web/app.js` 是一个可替换的 Demo 宿主，只使用公共 API。
- `scripts/build-runtime.sh` 从已固定的 miniJVM、freej2meOnMinijvm 和 FreeJ2ME Plus 提交生成运行时资产。

## 生命周期

运行时状态为：

```text
CREATED → LOADING → RUNNING ↔ PAUSED
                         ↕
                   CHECKPOINTING
                         │
                         ▼
                      EXITING → EXITED
```

任何不可恢复错误进入 `FAILED`。同一实例只允许调用一次 `mount()`，`exit()` 必须幂等。退出后不得留下可交互 Canvas、按键状态、音频或可继续读写的 checkpoint 入口。

## 内容和宿主边界

- 输入内容类型为 `J2ME_JAR_V1`，必须同时提供 URL、精确字节数和小写 SHA-256。
- 下载长度、ZIP/JAR 签名或摘要不一致时失败关闭，不尝试宽松加载。
- 每个运行实例使用宿主传入的 window/frame，不占用全局 `window.Module`。
- WebAssembly pthread 要求 `SharedArrayBuffer` 和 COOP/COEP；渲染和音频分别需要 WebGL2 与 Web Audio。
- `HOST` 存储由宿主显式传入/取走 checkpoint；`BROWSER` 使用 IDBFS，主要供 Demo 本地持久化。

## 输入与画面

宿主通过逻辑 J2ME 动作输入，不需要伪造 DOM 键盘事件。标准映射覆盖方向、确认、左右软键、数字、`*` 和 `#`。暂停、退出、失焦或手柄断开时必须释放全部按键。

LCD 逻辑尺寸与显示缩放分离。截图、指针坐标和游戏逻辑仍使用原始 viewport，显示层可选 `INTEGER_NEAREST`、`SHARP_FIT` 或 `SCALE2X`。
