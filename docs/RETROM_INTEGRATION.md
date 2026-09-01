# Retrom 接入说明

分析基线为 [`retrom-project/retrom-runtime@ac99ff286a13fb8af89ea9a70a175c5373b16bd1`](https://github.com/retrom-project/retrom-runtime/tree/ac99ff286a13fb8af89ea9a70a175c5373b16bd1)。该项目要求每个核心使用统一 `GameRuntime` 生命周期，显式声明内容源、能力、game compatibility line、save ABI 与可读取的旧 ABI；宿主只提供 URL、frame、restore payload 和诊断回调，核心不能调用 Retrom 的用户、上传或存档 HTTP API。

## 准入能力对照

| Retrom 能力 | j2me-web 0.2.0 | 说明 |
| --- | --- | --- |
| 模块化实例 | 已完成 | Emscripten 使用 `MODULARIZE + EXPORT_ES6`，不再占用 `window.Module` |
| 统一生命周期 | 已完成 | 状态、串行操作、取消、幂等退出和公共事件由 `GameRuntimeController` 管理 |
| 内容契约 | 已完成 | `J2ME_JAR_V1` 要求 URL、精确大小和 SHA-256；长度、摘要或 JAR 签名不一致时失败关闭 |
| 加载进度 | 已完成 | JAR 流式下载发布 `PROJECT_CONTENT`，checkpoint 导入发布 `RESTORE` |
| Canvas / 截图 / 帧计数 | 已完成 | 宿主取得放大后的 LCD canvas；PNG 截图和单调帧计数可用 |
| 低分辨率缩放 | 已完成 | 能力清单公开 `INTEGER_NEAREST`、`SHARP_FIT`、`SCALE2X`，配置和运行中切换均走公共 API |
| 输入契约探针 | 已完成 | `J2ME_INPUT_V1` 返回 FreeJ2ME 即将交给 MIDlet 的最终键值，供准入自动化验证；不是产品遥测接口 |
| 暂停 / 继续 | 已接入 | 暂停 Emscripten 主循环、输入和 Web Audio；miniJVM 其他 pthread 的完全挂起仍需 VM 级控制 |
| 标准手柄 | 已接入 | D-pad/左摇杆、A、B、X、Start/Select 映射为 J2ME 方向、确认和软键；退出时释放 |
| 核心主动退出 | 已接入 | launcher 监控 `MobilePlatform.appTerminated`，以稳定标记转换为一次 `EXIT_REQUESTED` |
| 有界 checkpoint | 部分完成 | 完整 RMS 文件树绑定游戏摘要，格式稳定且上限 2 MiB；可在新实例启动前恢复 |
| 新实例直接恢复执行点 | **未完成** | RMS 不是 miniJVM/线程/堆快照；部分游戏仍会进入自身标题或读档菜单 |
| 不可变 Release 资产 | 已完成 | `release:build` 生成逐资产 SHA-256/大小和 `j2me-runtime-release.json`；`v*` workflow 发布 |

`runtime-manifest.json` 因此标记为 `CANDIDATE`。在 Retrom 的稳定 manifest 登记 J2ME 前，必须先解决最后一项执行状态恢复，或由 Retrom 明确建立一种区别于即时 checkpoint 的“仅云存档文件”能力；本任务按要求没有修改 `retrom-runtime`，也没有用宿主旁路伪装该能力。

## 公共配置

```js
const config = {
  sessionId: "launch-1",
  contentDigest: "<64-hex sha256>",
  source: {
    kind: "J2ME_JAR_V1",
    name: "game.jar",
    url: "https://content.example/game.jar",
    sizeBytes: 123456,
    sha256: "<same 64-hex sha256>"
  },
  adapter: {
    adapterKind: "J2ME_MINIJVM_WEB",
    adapterId: "j2me-minijvm-web",
    runtimeBaseUrl: "https://assets.example/j2me/v0.2.0/",
    storage: "HOST",
    viewport: { width: 240, height: 320 },
    scalingMode: "SHARP_FIT"
  }
};

const runtime = createRuntime(config, {
  frameWindow,
  restorePayload,
  signal,
  onDiagnostic
});
runtime.subscribe(onRuntimeEvent);
await runtime.mount(container);
```

`contentDigest` 与 `source.sha256` 必须相同。Retrom 应使用 `storage: "HOST"`，每次 Launch 使用独立 frame，并通过 `restorePayload` 传回 checkpoint；`BROWSER` 会挂载 IDBFS，仅用于仓库 Demo。一个已退出的 frame 应由宿主丢弃，以释放 Emscripten 的 document 级监听与 pthread。

## 公共事件和操作

事件与 Retrom v2 契约一致：

- `LOAD_PROGRESS`
- `READY`
- `STATE_CHANGED`
- `CHECKPOINT_AVAILABILITY_CHANGED`
- `FATAL_ERROR`
- `EXIT_REQUESTED`

运行时提供 `mount`、`pause`、`resume`、`checkpoint`、`screenshot`、`exit`、`getScalingMode`、`setScalingMode`、`getValidationProbe`、状态/能力/Canvas/帧计数查询和 `subscribe`。`J2ME_INPUT_V1` 仅用于集成/准入测试。Demo 专用的 `unlockAudio`、`setViewMode` 与 `setViewport` 是附加便利方法，Retrom adapter 不需要依赖。

## Checkpoint 格式

`j2me-rms-bundle-v1` 使用确定性二进制封装：魔数/版本、32 字节游戏 SHA-256、文件数以及排序后的相对路径和文件字节。解码拒绝：

- 另一游戏的摘要；
- 绝对路径、`..`、反斜杠、空段和重复路径；
- 截断、尾随数据、未知版本；
- 超过 2 MiB 的 payload。

恢复发生在 `/game.jar` 写入和 MIDlet 启动之前。实测《魔塔》原始 8 个 RMS 文件合计 922 B，封装后 1202 B，未启用压缩。若真实样本超过 2 MiB，应增加新的、带格式版本的压缩 save ABI，而不是改变 v1 的解释。

当前格式只保存 RecordStore。`retrom-runtime` 的稳定准入规范还要求在新的 runtime 实例中无需游戏菜单即可恢复到 checkpoint 状态。要满足该语义，需要在 miniJVM/FreeJ2ME fork 增加一致的暂停点、Java 堆/线程/本地媒体状态序列化和跨实例恢复；原始 Wasm memory 拷贝不能安全替代，因为 pthread worker、Wasm 调用栈和浏览器音频对象不在同一可恢复边界。

## Release 资产

每个 `vX.Y.Z` Release 包含：

- `runtime.js`, `runtime.wasm`, `runtime.data`, `runtime.worker.js`
- `runtime-api.js`, `runtime-controller.js`, `checkpoint-codec.js`
- `audio-policy.js`, `input-probe.js`, `video-scaling.js`
- `runtime-manifest.json`, `THIRD_PARTY_NOTICES.md`
- `j2me-runtime-release.json`

`j2me-runtime-release.json` 采用 Retrom core Release metadata 的 `schemaVersion: 1` 形状，记录 repository、tag、tag commit、`adapterAbi`、固定依赖提交以及每个资产的观察 SHA-256 和大小。

## 后续在 retrom-runtime 的独立接入步骤

本仓库发布满足条件的稳定版本后，Retrom 侧仍需在独立任务中：

1. 增加 `J2ME_JAR_V1`、`J2ME_MINIJVM_WEB` 的类型和配置校验。
2. 新增只包装本公共 API 的 adapter，不复制 Demo 逻辑。
3. 在 aggregate manifest 固定本仓库、不可变 tag、tag commit、metadata URL、资产名和 adapter ABI。
4. 增加 controller/adapter 单测与可再分发 JAR fixture。
5. 在真实 Retrom 中验证 Import、审核预览、Product Launch、标准手柄、checkpoint、不同 Launch 恢复、恢复后输入和游戏主动退出。
6. 保留 COOP/COEP，确保 Player frame 的 `crossOriginIsolated === true`。
