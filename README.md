# j2me-web

`j2me-web` 是一个不依赖 CheerpJ 的开源 J2ME 浏览器运行时。它将 miniJVM 编译为 WebAssembly，使用 FreeJ2ME Plus 实现 MIDP 及常见厂商 API，并提供可嵌入其他 Web 应用的公共 JavaScript API。

当前版本为 `0.3.2`。

## 主要能力

- CLDC/MIDP 2D 画面、非标准分辨率和多种低分辨率缩放方式。
- 键盘、触摸虚拟键与标准 Gamepad 输入。
- MIDI、PCM/WAV，以及 AMR、AAC、MP3 的浏览器解码回退。
- M3G 和 Mascot Capsule 3D 的 WebGL2 后端。
- RMS 浏览器持久化和可由宿主保管的 checkpoint。
- 按 JAR SHA-256 选择屏幕、机型、输入、音频和 3D 兼容策略。

## 快速开始

构建需要 Node.js 18+、Docker、Git 和 curl。浏览器需要支持 WebAssembly threads、`SharedArrayBuffer`、WebGL2 和 Web Audio。

```bash
npm ci
npm run build:runtime
npm run dev
```

打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)，选择一个自己合法取得的 `.jar` 文件即可启动。Demo 支持暂停/继续、截图、触屏按键、缩放切换以及 checkpoint 导入导出。

> 仓库不分发商业 JAR 或测试游戏。`fixture/` 仅是维护者本地可选目录，已被 Git 忽略，不属于开源检出内容；使用者只需选择自己合法取得的 JAR。

生成的运行时位于 `public/runtime/`，下载缓存位于 `.cache/upstream/`；两者都不提交到 Git。

## 嵌入使用

源码入口是 `web/runtime-api.js`；Release 中对应的单文件 ESM 入口为 `j2me-runtime.js`：

```js
import { createRuntime } from "./j2me-runtime.js";

const runtime = createRuntime({
  sessionId: "launch-1",
  contentDigest: jarSha256,
  source: {
    kind: "J2ME_JAR_V1",
    name: "game.jar",
    url: jarUrl,
    sizeBytes: jarSize,
    sha256: jarSha256
  },
  adapter: {
    adapterKind: "J2ME_MINIJVM_WEB",
    adapterId: "j2me-minijvm-web",
    runtimeBaseUrl: runtimeAssetBaseUrl,
    storage: "HOST",
    viewport: { width: 240, height: 320 },
    scalingMode: "SHARP_FIT"
  }
}, {
  frameWindow: window,
  restorePayload,
  onDiagnostic: console.info
});

runtime.subscribe(handleRuntimeEvent);
await runtime.mount(container);
```

公共对象提供启动、暂停/继续、输入、截图、checkpoint、缩放策略、帧计数、状态事件和幂等退出。完整配置、事件、部署要求和发布资产见 [宿主集成说明](docs/HOST_INTEGRATION.md)。

## Demo 操作

- 默认显示并等比放大游戏 LCD；可切换为 miniJVM 完整模拟器窗口。
- `SHARP_FIT` 优先铺满，`INTEGER_NEAREST` 使用整数倍像素，`SCALE2X` 使用像素邻域放大。
- 方向键/WASD 控制方向，Enter 确认，Q/E 对应左右软键，数字键按原值传递。
- 游戏启动后默认尝试恢复 Web Audio；浏览器的自动播放策略可能仍要求一次页面交互。
- Demo 的 `BROWSER` 存储使用 IDBFS；嵌入式宿主可使用 `HOST` 模式自行保管 checkpoint。

## 部署要求

WebAssembly pthread 要求 cross-origin isolation。静态服务器必须返回：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

## 构建与依赖

miniJVM、freej2meOnMinijvm 和 FreeJ2ME Plus 均由可维护 fork 的完整提交固定构建，不依赖浮动版本。构建脚本同时固定 Emscripten、TinySoundFont、SoundFont 和音频专用 FFmpeg Wasm。详细来源和授权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，分支与发布见 [维护说明](docs/MAINTENANCE.md)。

如需使用本地 fork 构建：

```bash
MINIJVM_REPOSITORY=/path/to/miniJVM \
FREEJ2ME_REPOSITORY=/path/to/freej2meOnMinijvm \
FREEJ2ME_PLUS_REPOSITORY=/path/to/freej2me-plus \
npm run build:runtime
```

## Release

每个版本发布一个 `j2me-web-vX.Y.Z-runtime.zip` 完整运行时包，以及对应的 `.sha256` 和 `j2me-runtime-release.json`。压缩包内以版本化目录为根，包含单一公共 ESM bundle、Wasm、pthread worker、预加载数据、音频转码 worker、manifest、文档和第三方声明；内部实现模块不再作为独立 Release 附件分发。

## 文档

- [架构与运行时契约](docs/ARCHITECTURE.md)
- [宿主集成](docs/HOST_INTEGRATION.md)
- [Checkpoint 格式与存储语义](docs/CHECKPOINTS.md)
- [兼容性与已知限制](docs/COMPATIBILITY.md)
- [测试与本地样本](docs/TESTING.md)
- [维护与发布](docs/MAINTENANCE.md)

## 开发

```bash
npm ci
npm run check
```

涉及真实 Wasm/浏览器的验证、本地 JAR 样本和发布前检查见 [docs/TESTING.md](docs/TESTING.md)。
