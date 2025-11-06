# Tauri v2 拖拽检测与权限说明

本文记录本项目在从 Tauri v1 思维迁移到 v2 后，文件拖拽检测无法生效、ACL 报错的根因与修复方法。

## 症状与根因

- 现象 1：`tauri::generate_context!()` 在构建阶段 panic，报错 UnknownPermission，如：
  - `failed to resolve ACL: UnknownPermission { key: "core:window", permission: "allow-listen" }`
  - 原因：Tauri v2 的权限清单不再存在 `core:window/allow-listen` 这一项。

- 现象 2：Rust 侧编译错误找不到 v1 的 API：
  - `tauri::window::FileDropEvent`、`WebviewWindow.on_file_drop` 在 v2 已删除。
  - v2 将拖拽改为事件流（drag-enter/over/drop/leave），前端通过 `@tauri-apps/api` 监听。

- 现象 3：前端监听 `tauri://file-drop*` 无回调。
  - v2 的推荐方式是使用 `onDragDropEvent` 包装器，并且需要显式开启事件监听权限。

## 关键修改

- app/src-tauri/tauri.conf.json:16
  - 为唯一窗口显式设置 label：`"label": "main"`
  - 目的：确保能力（capability）的 `windows: ["main"]` 匹配正确窗口。

- app/src-tauri/tauri.conf.json:37
  - 在权限清单中加入：`"core:event:allow-listen"`
  - 目的：允许前端 `listen/once/onDragDropEvent` 等事件订阅行为。

- app/src/pages/ModernHomePageV2.tsx:155 起
  - 统一改为 v2 API：
    ```ts
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const webview = getCurrentWebviewWindow()
    const unlisten = await webview.onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type === 'over' || payload.type === 'enter') setIsDragging(true)
      else if (payload.type === 'leave') setIsDragging(false)
      else if (payload.type === 'drop') {
        const pdf = (payload.paths || []).find((p) => p.toLowerCase().endsWith('.pdf'))
        if (pdf) handleFileSelect(pdf)
      }
    })
    ```
  - 不再监听 `tauri://file-drop*`，而是由包装器统一转发四种拖拽事件。

- app/src-tauri/src/lib.rs:58
  - 使用 `window.on_window_event` 打印窗口事件，便于调试；不再使用 v1 的 `on_file_drop`。

## 原理说明（Tauri v2 权限与事件）

- v2 的 ACL 以“插件命名空间”为前缀，例如 `core:event:*`、`core:window:*`、`fs:*` 等。
- 拖拽并非 `core:window/allow-listen`，而是事件系统权限 `core:event:allow-listen`。
- 拖拽事件在前端通过 `@tauri-apps/api` 暴露为：
  - `TauriEvent.DRAG_ENTER` / `DRAG_OVER` / `DRAG_DROP` / `DRAG_LEAVE`
  - 推荐使用 `getCurrentWebviewWindow().onDragDropEvent(...)` 统一处理。
- 能力（capabilities）可限定窗口范围：本项目使用 `windows: ["main"]` 来限制权限只对主窗口生效。

## 验证步骤

1. 运行：`cd app/src-tauri && cargo run --no-default-features`
2. 打开 DevTools 控制台，看到“Drag & drop listener ready”。
3. 在 Tauri 窗口中拖入/悬停/离开/释放 PDF，前端能收到回调并跳转预览。
4. 若无响应，确认：
   - 窗口 label 为 `main`（配置已添加）。
   - 正在 Tauri 窗口中测试（非浏览器 tab）。
   - 依赖版本为 `@tauri-apps/api@^2`，并安装完成。

## 常见问题

- DevTools 停靠在窗口内时，拖拽坐标可能不准确（事件仍会触发）。如需准确坐标，可分离调试器。
- macOS 控制台可能输出 WebKit/IMK 日志（如 `RemoteLayerTreeDrawingAreaProxyMac::scheduleDisplayLink()`），一般可忽略。

## 后续可加固

- 进一步收紧权限：只给必要窗口赋予 `core:event:allow-listen`。
- 如需在后端（Rust）也处理拖拽，可在 `on_window_event` 中匹配 drag 相关事件并 `emit` 给前端，但 v2 前端包装器已足够。

