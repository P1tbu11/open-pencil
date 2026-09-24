# UI 拆分工作台

基于 OpenPencil 0.15.1 / commit `8131401ead4fee3c479961aab093c72dc5ef33bb` 的独立分支。

## 启动

项目根目录双击 `启动 UI 拆分工作台.command`，打开 http://127.0.0.1:1420。
开发环境需要 Bun；macOS 本机 OCR 还需要 Xcode Command Line Tools（Swift / Vision）。

```sh
bun install --frozen-lockfile
bun run build:packages
bun run slice:setup  # macOS，本机文字识别；其他系统可跳过
bun run slice:dev
```

`slice:dev` 同时启动编辑器 1420 和本机服务 1421。服务只监听本机；开发 CORS 仅允许 1420 的 localhost / 127.0.0.1。

## 使用流程

1. 点击画布上方「UI 拆分工作台」，导入 PNG、JPG、WebP，或点击「体验示例」。示例框是预先准备的区域，不是模型识别结果。
2. 点击「绘制区域」后在图片上拖拽；点击已有区域可以移动、缩放。属性区可改精确坐标、类型、层级、文字与颜色。
3. 「本机文字识别」使用 Apple Vision，替换文字区域并保留图片区域。字号是估计值、字体和颜色是默认值，需要校正。
4. 「本地快速拆分」进行矩形裁剪、边缘连通纯色去底、区域边界插值修复。被图片区域包含的文字也会被清理。适合纯色界面，不保证复杂背景的修复质量。
5. 结果成为 OpenPencil 原生 Frame、Rectangle/Image Fill 和 Text。关闭工作台后可移动元素、修改文字与样式；一次撤销可移除整次导入。
6. 「保存拆分工程」下载 `.uislice`，包含源图、区域和结果；重新导入后点击「恢复到画布」。OpenPencil 原有 `.fig` 保存负责保存完整原生设计文档。请在刷新前保存尚未导入画布的标注。
7. 「导出结果」读取当前结果画板，或没有关联结果时读取所选画板。PSD 包含像素预览和文字信息；PNG 包含素材及 JSON 清单。

## 导出边界

- PSD：已检查实际浏览器生成文件的尺寸、层序、位置、文字内容。仍需 Photoshop 打开验收；字体缺失或文字引擎差异可能要求更新文字层。
- Godot 4：生成 project.godot / ui.tscn / TextureRect / Label / PNG；已检查归档与场景结构，尚未在 Godot 应用中运行验收。
- Unity：导出 uGUI 编辑器导入脚本，生成 Canvas、Image、Text、Prefab；待 Unity 实机验收。
- Cocos Creator 3.8 / 2.4：导出资源和编辑器模式组件；待对应引擎实机验收。
- 字体文件不包含在导出包中。程序交互、动画和业务逻辑不由截图自动生成。
- 当前专用导出面向拆分产生的简单图层；旋转会明确拒绝。多样式富文本、复杂组效果、裁切/遮罩、父级变换和高级排版尚未完整保真。

## 云端模型连接

未配置时，「AI 自动识别」和「AI 原位拆分」会明确报错，不会返回占位成功结果。

可以在工作台填写兼容本协议的服务地址和令牌；令牌只在当前内存会话保存，不写入工程文件。
也可以使用本机网关（默认 http://127.0.0.1:1421）并在项目根目录 `.env.local` 配置：

```dotenv
# 完整的视觉聊天请求地址，兼容 messages/image_url/JSON response 格式
VISION_API_URL=https://your-provider.example/v1/chat/completions
VISION_API_KEY=
VISION_MODEL=
# 专用透明分层与背景补全服务，不能用普通聊天接口替代
SLICE_WORKER_URL=https://your-layer-worker.example
SLICE_WORKER_TOKEN=
```

改配置后重启本机服务。未附带任何付费账号、密钥或专用分层模型权重。

### 服务协议 v1

请求 `POST /detect` 或 `POST /split`：

```json
{
  "version": 1,
  "source": { "name": "游戏大厅", "width": 960, "height": 600, "dataURL": "data:image/png;base64,..." },
  "regions": [{ "id": "coin", "name": "金币", "kind": "image", "x": 54, "y": 38, "width": 64, "height": 64, "z": 1 }]
}
```

返回 `{"layers":[...]}`。坐标以原图左上角为原点，单位为像素。`z` 越大越靠前。
`detect` 的条目字段与区域一致；文字还需 text / fontSize / fontFamily / color (#RRGGBB)。
`split` 的每个图片条目还需 `pngBase64`（纯 Base64，不含 dataURL 前缀），PNG 必须是该图层的素材。
返回完整背景作为最底层图层，并从背景与其他相关图层中移除已提取的文字、元素；按区域边界补齐被遮挡的内容。
同一返回内 ID 必须唯一，不能越界；空素材、无效坐标会在进入画布之前拒绝。
错误应返回非 2xx 和 `{"error":"可供用户阅读的说明"}`。取消和超时由 AbortSignal 传递。

## 验证

```sh
bun test tests/app/ui-slicing
bun run lint
bun run typecheck
bun x vite build
```

真实模型质量尚未验收。接入服务后应使用至少 10 张真实游戏截图检查透明边缘、遮挡补全、去字、字体与坐标，再决定默认服务及价格策略。
