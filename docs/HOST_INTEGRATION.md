# 宿主集成

## 基本配置

```js
import { createRuntime } from "./j2me-runtime.js";

const source = {
  kind: "J2ME_JAR_V1",
  name: "game.jar",
  url: "https://content.example/game.jar",
  sizeBytes: 123456,
  sha256: "<64-hex sha256>"
};

const runtime = createRuntime({
  sessionId: crypto.randomUUID(),
  contentDigest: source.sha256,
  source,
  adapter: {
    adapterKind: "J2ME_MINIJVM_WEB",
    adapterId: "j2me-minijvm-web",
    runtimeBaseUrl: "https://assets.example/j2me/v0.3.2/",
    storage: "HOST",
    viewport: { width: 240, height: 320 },
    scalingMode: "SHARP_FIT"
  }
}, {
  frameWindow,
  restorePayload,
  signal,
  onDiagnostic
});

runtime.subscribe(onRuntimeEvent);
await runtime.mount(container);
```

`contentDigest` 与 `source.sha256` 必须相同。宿主应为每次启动创建独立 frame/window，并在实例退出后丢弃该 frame，以释放 Emscripten 侦听器与 pthread worker。

## 事件

宿主可在 `mount()` 之前订阅：

- `LOAD_PROGRESS`
- `READY`
- `STATE_CHANGED`
- `CHECKPOINT_AVAILABILITY_CHANGED`
- `FATAL_ERROR`
- `EXIT_REQUESTED`

## 公共操作

运行时提供 `mount`、`pause`、`resume`、`checkpoint`、`screenshot`、`exit`、`setInput`、`getScalingMode`、`setScalingMode`、Canvas/帧计数/状态查询和事件订阅。`getValidationProbe()` 为调试与自动化提供输入、GC、媒体与 3D 观测数据，不应作为游戏业务状态。

`setInput(action, pressed)` 只接受 `runtime-manifest.json` 声明的逻辑动作。宿主的虚拟键、键盘或手柄层应统一转成这些动作。

## 存储模式

- `HOST`：运行时只读取显式 `restorePayload`，宿主通过 `checkpoint()` 取得数据并自行保存。
- `BROWSER`：使用当前页面的 IDBFS 持久化，适合单机 Demo，不应被多用户宿主默认共享。

Checkpoint 的边界和限制见 [CHECKPOINTS.md](CHECKPOINTS.md)。

## 发布资产

`vX.Y.Z` Release 提供 `j2me-web-vX.Y.Z-runtime.zip`、对应 SHA-256 文件和 `j2me-runtime-release.json`。解压目录中的 `j2me-runtime.js` 是唯一公共 ESM 入口；Wasm、pthread worker、预加载数据和音频转码器作为运行时旁置资产保留。metadata schema v2 记录压缩包与解压后运行资产的大小和 SHA-256。

宿主必须提供 COOP/COEP 以启用 cross-origin isolation，并保证运行时资产可以被 worker 和 Wasm 从同一隔离上下文加载。
