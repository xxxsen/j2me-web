# j2me-web

`j2me-web` 是一个不依赖 CheerpJ 的浏览器 J2ME 运行时。它把 miniJVM 编译为 WebAssembly，以 FreeJ2ME Plus 提供 MIDP/厂商 API 实现，并通过一个轻量页面加载 fixture 或本地 JAR。

当前版本为 `0.2.2`。本版修复 miniJVM 类初始化失败后污染调用者操作数栈的问题，并让 MIDI 在 `Player` 创建时立即异步准备；《仙剑奇侠传》现在无需确认“新的历程”或进入地图，即可在主菜单开始背景音乐。既有 Retrom 公共 API、RMS checkpoint、画面缩放、端到端输入和 pthread GC 契约保持不变。原有 Demo 页面仍保留，并且只通过同一公共 API 启动游戏。详细能力与边界见 [Retrom 接入说明](docs/RETROM_INTEGRATION.md) 和 [兼容性报告](docs/COMPATIBILITY.md)。

## 快速开始

构建需要 Node.js 18+、Docker、Git 和 curl。浏览器需要支持 WebAssembly threads、`SharedArrayBuffer`、WebGL2 与 Web Audio。

```bash
npm run build:runtime
npm run dev
```

打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)，选择 `fixture/J2ME` 中的游戏或上传本地 `.jar`，然后点击“启动游戏”。Demo 还可暂停/继续、导出 `.j2mecp` checkpoint，或在启动前导入 checkpoint。生成的运行时位于 `public/runtime`，下载缓存位于 `.cache/upstream`；两者都不会提交到 Git。

可用查询参数：

```text
?autostart=1&fixture=魔塔.jar
?autostart=1&fixture=魔塔
?autostart=1&fixture=0
```

`fixture` 可使用完整文件名、文件名片段或下拉列表索引，适合浏览器自动化烟测。

## 公共运行时 API

`web/runtime-api.js` 提供与 `retrom-runtime` 的 `GameRuntime` 同形生命周期，宿主不需要接触 Emscripten `Module` 或 `FS`：

```js
import { createRuntime } from "./runtime-api.js";

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
    scalingMode: "SHARP_FIT",
    compatibilityProfile: {
      phone: "Nokia",
      input: { softKeySwap: false },
      audio: { enabled: true, gain: 1, transcodeFallback: true },
      graphics3d: { backend: "AUTO", halfResolution: false }
    }
  }
}, {
  frameWindow: window,
  restorePayload,
  onDiagnostic: console.info
});

runtime.subscribe(handleRuntimeEvent);
await runtime.mount(container);
```

公共对象提供 `pause()`、`resume()`、`checkpoint()`、`screenshot()`、`exit()`、`setInput()`、`getScalingMode()`、`setScalingMode()`、`getValidationProbe()`、能力/状态查询和事件订阅。`resolveCompatibilityProfile()` 按内容 SHA-256 解析内置档案，宿主也可显式覆盖分辨率、机型、按键、音频和 3D 策略；不根据文件名猜测游戏。`HOST` 模式由 Retrom 保存 checkpoint，`BROWSER` 模式只用于 Demo 的 IDBFS 持久化。JAR 的精确长度、ZIP 签名与 SHA-256 会在启动前验证。完整配置、事件和发布资产见 [Retrom 接入说明](docs/RETROM_INTEGRATION.md)。

## 使用说明

- 默认只显示并等比放大游戏 LCD；“显示模拟按键”可切回 miniJVM 的完整模拟器窗口。
- 画面区域默认是 240×320。《仙剑奇侠传》会自动裁取其实际使用的 128×144 区域，也可以手动选择其他尺寸。
- `SHARP_FIT`（默认）保持宽高比并用最近邻锐利铺满；`INTEGER_NEAREST` 只用整数倍像素，最清晰但可能留边；`SCALE2X` 先用像素邻域算法生成 2× 帧，再铺满显示区。
- 键盘支持方向键、WASD、Enter 和数字键，Q / E 对应左右软键；放大画面上的指针事件会映射回模拟器 LCD。Demo 的“触屏按键”提供方向、确认、软键、数字、`*`、`#`，支持多指与长按重复，并只通过公共 `setInput()` 接口发送输入。
- 游戏启动后默认恢复 Web Audio，并在运行初期、键盘或指针输入时自动重试，不要求用户再手动开启音乐。浏览器的全局自动播放策略仍可能要求一次页面交互。
- Demo 的 RMS 写入 `/appdata/freej2meonminijvm.jar/rms/rms` 并通过 IDBFS 持久化；宿主的 `HOST` 模式不读取该浏览器数据，只接受显式 `restorePayload`。
- 当前一次页面生命周期只运行一个 JAR；切换游戏请重新加载页面。

页面会先检查 ZIP/JAR 文件签名，避免把扩展名错误的 SIS、HTML 下载页等文件交给虚拟机。

## 运行架构

```text
Retrom 配置 / Demo fixture / 本地 JAR
        │
        ▼
runtime-api（生命周期、校验、输入、checkpoint）
        │
        ▼
模块化 Emscripten MEMFS (/game.jar) + 可选 IDBFS
        │
        ▼
miniJVM.wasm ── WebLauncher ── freej2meOnMinijvm
        │                              │
        │                              ▼
        │                       FreeJ2ME Plus / MIDlet
        │                              │
        ├── NanoVG + WebGL2 ───────────┤──► Canvas
        │                              │
        └── TinySoundFont ────────────────┘──► Web Audio
```

音频资源在 FreeJ2ME Plus 的已知字节边界内直接交给轻量 miniJVM Player，不再经过临时文件 EOF 探测或加载整套桌面 Java Sound。损坏的派生切片流会从最近的完整资源中恢复结构有效的打包 MIDI；MIDI 在 Player 创建时立即于后台准备，由 TinySoundFont 和 TimGM6mb SoundFont 以 22.05 kHz 单声道渲染，同内容请求共享结果，再由浏览器主线程上的 Web Audio 解码和播放。运行时会在启动和用户输入时自动恢复音频，并在暂停/退出时挂起。miniJVM 会隔离类初始化期间被抑制的解析异常，避免它们破坏 MIDlet 正在执行的播放器赋值表达式。这条链路修复了此前的噪音、浑浊、长时间静音，以及《仙剑奇侠传》必须进入地图后才有背景音乐的问题。

`server.mjs` 会为全部响应设置以下头部，部署到其他静态服务器时必须等价保留：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

## 依赖仓库与固定版本

构建默认只使用维护在 `xxxsen` 下的三个 fork，并固定到完整提交，避免上游变化导致不可复现构建：

| 层 | 仓库 | 固定提交 | 上游基线 |
| --- | --- | --- | --- |
| JVM/Wasm | [xxxsen/miniJVM](https://github.com/xxxsen/miniJVM) | `a2dd48c1cea0b4bcd4fccc2cf843be2686a6d2a0` | `digitalgust/miniJVM@ac94e62781deda037875ff69d78f272a327a72bc` |
| miniJVM 适配 | [xxxsen/freej2meOnMinijvm](https://github.com/xxxsen/freej2meOnMinijvm) | `1deb29732aa5a64fa61a1dc7fffd7fa9afd3a08e` | `digitalgust/freej2meOnMinijvm@c6af07fffde51fe1b1959f584376dec8d912d456` |
| 模拟器核心 | [xxxsen/freej2me-plus](https://github.com/xxxsen/freej2me-plus) | `ef35d77eef84d305d1d75769d0f7fdf1e6bc6509` | `TASEmulators/freej2me-plus@f68a12052532487f9606ba566b981aff19cc8887` |

此外固定使用 TinySoundFont `853a0a171759f1ddba0de1442133a75912bbeffa`、TimGM6mb SoundFont（SHA-256 `c5378b62028c920cb11e4803327983fee2f2cdff5dc89c708e39da417e51c854`）、Emscripten 3.1.46 和 Eclipse Temurin 8。

如需验证尚未推送的本地 fork，可覆盖仓库地址：

```bash
MINIJVM_REPOSITORY=/path/to/miniJVM \
FREEJ2ME_REPOSITORY=/path/to/freej2meOnMinijvm \
FREEJ2ME_PLUS_REPOSITORY=/path/to/freej2me-plus \
npm run build:runtime
```

分支、提交与发布 tag 规则见 [维护说明](docs/MAINTENANCE.md)，第三方授权信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 与 freej2me-web 的关系

本项目参考并吸收了 [zb3/freej2me-web](https://github.com/zb3/freej2me-web) 的浏览器端经验，包括持久化文件系统、按游戏加载、响应式画面、输入转发以及浏览器原生音频思路，但没有复制其 CheerpJ 运行链路。

当前项目的优势是 JVM、模拟器核心和 WebAssembly 构建都能自行维护、固定版本并离线部署。当前已补齐按 SHA-256 的游戏配置、移动端多点触控/重复键，以及 AMR/AAC/MP3 的音频专用 FFmpeg Wasm 回退；`freej2me-web` 仍在 WebGL 2 的 M3G/Mascot 3D、数据导入导出和视频媒体方面更成熟。这些差距被保留在兼容性报告中，不把“能够启动”表述成“完整兼容”。

## 开发检查

```bash
npm ci
npm run check
npm run build:runtime
npm run test:input
npm run test:audio
npm run test:media
npm run test:gc
npm run release:build
```

`test:input` 会启动真实 Wasm/MIDlet 和无头 Chromium，依次发送方向键、WASD、确认、左右软键及 0–9，并断言 FreeJ2ME 在交给 MIDlet 前观察到的最终键值，共覆盖 21 个浏览器按键；它不是只测 DOM `KeyboardEvent` 的映射表。

`test:audio` 只向《仙剑奇侠传》的“按任意键继续”发送一次确认键，随后停留在“新的历程 / 旧的回忆”主菜单；测试会等待 MIDI 解码和 Web Audio 进入运行状态，并断言没有媒体初始化异常。它不会通过进入地图来误判主菜单音乐已经修复。

`test:media` 在无头 Chrome 中直接运行发布版音频 Worker/Wasm，验证 AMR-NB、AAC-LC 与真实游戏 MP3 均转换为非静音 PCM WAV，并可由 Web Audio 解码。转码器只在 Chrome 原生解码失败时懒加载。

`test:gc` 会在真实 Wasm/MIDlet 中等待至少 3 个 GC 周期，断言有对象被回收、GC 后 Java 堆不持续发散、每次真实 STW 不超过默认 2 秒、画面帧继续推进，并在 GC 后再次验证输入。可用 `J2ME_GC_TEST_CYCLES=30 npm run test:gc` 做更长 soak，或用 `J2ME_GC_TEST_FIXTURE=仙剑奇侠传` 切换样本。

miniJVM GC 现已在 pthread 浏览器构建中启用。6 轮《魔塔》回归的 GC 后 Java 堆稳定在约 34–36 MiB，累计回收约 100 MiB；`0.2.2` 发布候选中《魔塔》和《仙剑奇侠传》观察到的最大真实 STW 分别为 87 ms 和 97 ms。Wasm 线性内存达到过的高水位不会向浏览器归还，但已释放块会被后续分配复用；正式服务仍应持续做小时级场景切换、真实手柄以及 Chrome 之外的多浏览器回归。
