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
    runtimeBaseUrl: "https://assets.example/j2me/v0.3.3/",
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

API 可以在父页面导入；`container` 必须属于 `frameWindow.document`。运行时通过旁置的 `runtime-loader.js` 在目标 frame 内加载核心，不使用 `eval`、内联模块或父页面的 `window.Module`。使用 CSP 时，应允许目标 frame 加载运行时目录中的外部模块、Wasm 和 worker。

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

`pause()` 在释放输入并停止呈现后，等待 JVM 线程到达安全点；Promise 完成后 Java 执行停止推进。暂停期间忽略新的逻辑按键和音频解锁，`resume()` 等待核心恢复后再开放输入。暂停不修改游戏使用的墙上时钟，恢复后游戏仍可能根据经过的真实时间更新自己的计时器。

`screenshot()` 返回逻辑 viewport 尺寸的 PNG，显示缩放和 Demo 的模拟器视图不改变截图尺寸。`getFrameCount()` 统计核心完成的画面提交次数，不代表 MIDlet 的业务循环次数。

加载中的 `exit()` / AbortSignal 会取消下载和启动，并清理已经创建的资源；退出 Promise 完成后不会启动迟到的模块。运行期 Wasm abort 和宿主桥接故障会触发 `FATAL_ERROR` 并进入 `FAILED`。宿主订阅者或诊断回调抛错不会打断运行时清理。

## 存储模式

- `HOST`：运行时只读取显式 `restorePayload`，宿主通过 `checkpoint()` 取得数据并自行保存。
- `BROWSER`：使用当前页面的 IDBFS 持久化，适合单机 Demo，不应被多用户宿主默认共享。

Checkpoint 的边界和限制见 [CHECKPOINTS.md](CHECKPOINTS.md)。

## 发布资产

`vX.Y.Z` Release 提供 `j2me-web-vX.Y.Z-runtime.zip`、对应 SHA-256 文件和 `j2me-runtime-release.json`。解压目录中的 `j2me-runtime.js` 是唯一公共 ESM 入口；Wasm、pthread worker、预加载数据和音频转码器作为运行时旁置资产保留。metadata schema v2 记录压缩包与解压后运行资产的大小和 SHA-256。

宿主必须提供 COOP/COEP 以启用 cross-origin isolation，并保证运行时资产可以被 worker 和 Wasm 从同一隔离上下文加载。
