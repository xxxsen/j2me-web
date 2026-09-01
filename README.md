# j2me-web

`j2me-web` 是一个不依赖 CheerpJ 的浏览器 J2ME 运行时。它把 miniJVM 编译为 WebAssembly，以 FreeJ2ME Plus 提供 MIDP/厂商 API 实现，并通过一个轻量页面加载 fixture 或本地 JAR。

当前版本为 `0.1.1`，新增面向 `retrom-runtime` 的宿主无关公共 API、模块化 Wasm 工厂、生命周期事件、标准手柄、截图和有界 RMS checkpoint，并修复《仙剑奇侠传》的红蓝通道交换、打包 MIDI 背景音乐和默认音频启动；原有 Demo 页面仍保留，并且只通过同一公共 API 启动游戏。详细能力与边界见 [Retrom 接入说明](docs/RETROM_INTEGRATION.md) 和 [兼容性报告](docs/COMPATIBILITY.md)。

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
    viewport: { width: 240, height: 320 }
  }
}, {
  frameWindow: window,
  restorePayload,
  onDiagnostic: console.info
});

runtime.subscribe(handleRuntimeEvent);
await runtime.mount(container);
```

公共对象提供 `pause()`、`resume()`、`checkpoint()`、`screenshot()`、`exit()`、能力/状态查询和事件订阅。`HOST` 模式由 Retrom 保存 checkpoint，`BROWSER` 模式只用于 Demo 的 IDBFS 持久化。JAR 的精确长度、ZIP 签名与 SHA-256 会在启动前验证。完整配置、事件和发布资产见 [Retrom 接入说明](docs/RETROM_INTEGRATION.md)。

## 使用说明

- 默认只显示并等比放大游戏 LCD；“显示模拟按键”可切回 miniJVM 的完整模拟器窗口。
- 画面区域默认是 240×320。《仙剑奇侠传》会自动裁取其实际使用的 128×144 区域，也可以手动选择其他尺寸。
- 全屏模式保持游戏原始宽高比，以像素风格缩放填满可用空间。
- 键盘支持方向键、WASD、Enter 和数字键，Q / E 对应左右软键；放大画面上的指针事件会映射回模拟器 LCD。
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
        └── TinySoundFont + miniaudio ─┘──► Web Audio
```

音频资源会在 FreeJ2ME Plus 的资源流边界稳定化，再以临时文件交给 miniJVM；损坏的派生切片流会从最近的完整资源中恢复结构有效的打包 MIDI。MIDI 由 TinySoundFont 和 TimGM6mb SoundFont 离线渲染，PCM 通过 miniaudio 播放；pthread 工作线程内的 Web Audio 操作会代理到浏览器主线程。这条链路修复了此前的噪音、沙沙声、浑浊以及《仙剑奇侠传》无背景音乐的问题。

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
| JVM/Wasm | [xxxsen/miniJVM](https://github.com/xxxsen/miniJVM) | `1778bd07fea64213d5e4d3061a489044abf458e7` | `digitalgust/miniJVM@ac94e62781deda037875ff69d78f272a327a72bc` |
| miniJVM 适配 | [xxxsen/freej2meOnMinijvm](https://github.com/xxxsen/freej2meOnMinijvm) | `e90225a2f992bec746435293fd2b9c401df9f5cc` | `digitalgust/freej2meOnMinijvm@c6af07fffde51fe1b1959f584376dec8d912d456` |
| 模拟器核心 | [xxxsen/freej2me-plus](https://github.com/xxxsen/freej2me-plus) | `bc6fc7cd03d8d7eeae40bceb86d7424efbacbc18` | `TASEmulators/freej2me-plus@f68a12052532487f9606ba566b981aff19cc8887` |

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

当前项目的优势是 JVM、模拟器核心和 WebAssembly 构建都能自行维护、固定版本并离线部署。`freej2me-web` 目前在 WebGL 2 的 M3G/Mascot 3D、按游戏配置与数据导入导出、移动端触控键盘、按键重复以及 FFmpeg/AMR/视频媒体方面更成熟。这些差距被保留在兼容性报告中，不把“能够启动”表述成“完整兼容”。

## 开发检查

```bash
npm ci
npm run check
npm run build:runtime
npm run release:build
```

当前 Emscripten pthread 构建为规避 stop-the-world 死锁禁用了 miniJVM GC，长时间运行时内存可能持续增长；正式服务还应增加长时游戏、反复场景切换和多浏览器回归。
