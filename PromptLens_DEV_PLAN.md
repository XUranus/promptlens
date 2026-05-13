# PromptLens 开发计划

## 1. 产品实施目标

PromptLens v0.1 的目标是交付一个本地优先的桌面 JSONL LLM 调用日志查看器，解决“打开、索引、检索、阅读、检查单条 LLM 调用”的核心问题。

MVP 必须完成：

- 打开本地 `.jsonl` 文件
- Rust 后端流式扫描 JSONL，并生成轻量索引
- 前端虚拟列表展示调用摘要
- 点击记录后懒加载完整 JSON
- 将 request / response 归一化为 LLM 对话视图
- 渲染 assistant Markdown
- 识别并预览 data URL / base64 图片
- 展示原始 JSON Tree
- 支持基础搜索、过滤和排序
- 全程本地运行，不上传、不遥测、不默认联网

MVP 暂不做：

- 多文件标签页
- SQLite / Tantivy 持久索引
- replay
- 团队协作
- 云同步
- 完整 trace graph
- 脱敏导出
- 成本价格表

## 2. 推荐技术架构

### 2.1 桌面应用

- Tauri 作为桌面壳
- Rust 负责文件访问、JSONL 扫描、懒读取、搜索和格式归一化
- React + TypeScript + Vite 负责 UI
- Zustand 负责前端状态
- Tailwind CSS + 自定义组件或 shadcn/ui 负责界面

### 2.2 前后端职责边界

Rust 后端负责：

- 文件选择后的路径管理
- JSONL 按行扫描
- byte offset / line number 索引
- 轻量摘要提取
- 单条记录完整读取
- provider adapter 归一化
- 图片字段探测
- 基础全文搜索

React 前端负责：

- 三栏布局和交互状态
- 虚拟滚动列表
- 搜索、过滤、排序 UI
- Conversation / Response / Images / Tool Calls 视图
- Markdown 渲染
- 图片预览弹窗
- JSON Tree 展示
- 快捷键、主题和设置

### 2.3 数据流

```text
Open File
  -> scan_jsonl(file_path)
  -> FileScanResult + LogSummary[]
  -> virtualized Log List
  -> select summary
  -> read_record(file_path, byte_offset, line_number)
  -> RecordDetail { summary, normalized, raw }
  -> Conversation / JSON Tree / Metadata
```

### 2.4 核心数据结构

前后端共享 TypeScript / Rust 对齐的数据模型：

- `LogSummary`：列表和筛选所需的轻量摘要
- `FileScanResult`：文件扫描结果和统计
- `RecordDetail`：单条记录完整详情
- `NormalizedCall`：LLM 语义归一化结构
- `NormalizedMessage`：对话消息
- `NormalizedContent`：文本、图片、tool call、tool result 等内容块

## 3. 模块设计

### 3.1 Rust 后端模块

```text
src-tauri/src/
  main.rs
  commands/
    mod.rs
    file.rs
    scan_jsonl.rs
    read_record.rs
    search.rs
  parser/
    mod.rs
    jsonl.rs
    summary.rs
    image_detector.rs
  adapters/
    mod.rs
    generic.rs
    openai.rs
    anthropic.rs
    gemini.rs
    ollama.rs
  models/
    mod.rs
    log_summary.rs
    normalized.rs
    record_detail.rs
  security/
    mod.rs
    redactor.rs
```

关键设计：

- `scan_jsonl` 只读取每行并提取摘要，不深度构建完整展示模型。
- `read_record` 根据 `byteOffset` 精准读取单行，再完整解析和归一化。
- adapter 先实现 `generic` 与 `openai`，其他 provider 在 v0.1 后半段补齐或降级 fallback。
- 图片探测只返回可预览元信息和 data URL，不批量解码所有图片。
- 搜索 MVP 采用流式逐行字符串匹配，不引入重型索引。

### 3.2 前端模块

```text
src/
  app/
    App.tsx
    AppShell.tsx
  components/
    SplitPane.tsx
    Toolbar.tsx
    EmptyState.tsx
    ErrorBoundary.tsx
  features/
    file-open/
    log-list/
    record-detail/
    conversation-view/
    markdown-renderer/
    image-preview/
    json-tree/
    search/
    filters/
    stats/
    settings/
  stores/
    fileStore.ts
    selectionStore.ts
    filterStore.ts
    settingsStore.ts
  types/
    log.ts
    normalized.ts
```

关键设计：

- 主界面固定为三栏：左侧列表，中间语义视图，右侧 metadata / JSON Tree。
- 左侧列表必须使用 `@tanstack/react-virtual`。
- 中间区域以 Conversation 为默认视图，避免产品退化成普通 JSON Viewer。
- JSON Tree 是辅助视图，默认折叠大字段和 base64 字段。
- 搜索结果点击后跳转并选中对应记录。

## 4. v0.1 里程碑

### Phase 0：工程初始化

目标：建立可运行桌面应用骨架。

任务：

- 初始化 Tauri + React + TypeScript + Vite
- 配置 ESLint / Prettier / Rust fmt / clippy
- 建立基础目录结构
- 实现 AppShell 三栏布局
- 实现深浅色主题
- 建立 Tauri command 调用封装

验收：

- `npm run dev` 可启动前端
- `cargo tauri dev` 可启动桌面应用
- 主界面三栏布局可见

### Phase 1：文件打开与扫描

目标：能打开 JSONL 文件并生成调用摘要列表。

任务：

- 实现文件选择器打开 `.jsonl`
- Rust 实现按行扫描
- 记录 `lineNumber`、`byteOffset`、解析成功/失败数
- 提取 timestamp、provider、model、status、usage、latency、preview
- 非法 JSON 行生成 `invalid_json` summary
- 前端展示文件基本信息

验收：

- 能打开示例 JSONL 文件
- 空行跳过，非法 JSON 行被标记
- 可展示总行数、成功数、失败数、文件大小

### Phase 2：虚拟列表与基础交互

目标：10 万条以内列表可滚动查看。

任务：

- 集成 `@tanstack/react-virtual`
- 实现列表字段：时间、model、provider、status、latency、tokens、image/tool 标记、preview
- 实现记录选中状态
- 支持键盘上下切换
- 添加基础 loading / empty / error 状态

验收：

- 10 万条 mock summary 滚动不卡顿
- 选中记录时 UI 状态稳定

### Phase 3：单条记录详情与 JSON Tree

目标：点击列表记录后展示完整原始 JSON。

任务：

- Rust 实现 `read_record(filePath, byteOffset, lineNumber)`
- 完整解析单条 JSON
- 返回 `RecordDetail`
- 前端展示 Metadata
- 接入 JSON Tree 组件
- 大字段默认折叠
- base64 字段默认截断
- 支持复制当前记录 JSON

验收：

- 点击任意合法记录可在 300ms 量级显示详情
- 非法 JSON 行显示解析错误
- 大 base64 字段不会撑爆 UI

### Phase 4：Normalized Schema 与 Adapter

目标：把常见 LLM 日志转为统一 Conversation 结构。

任务：

- 定义 Rust / TypeScript 对齐的 `NormalizedCall`
- 实现 generic adapter
- 实现 OpenAI Chat Completions adapter
- 实现 OpenAI Responses API 基础识别
- 提取 request messages、assistant response、usage、error、tool calls
- 对未知结构保持 raw JSON 可用

验收：

- 推荐内部日志格式能完整渲染
- OpenAI Chat Completions 格式能渲染 request / response
- 未知格式至少能显示 preview 和 raw JSON

### Phase 5：Conversation、Markdown 与图片

目标：形成 PromptLens 的核心差异化阅读体验。

任务：

- 实现 role message card
- 支持 system / developer / user / assistant / tool / function / unknown
- OpenAI content array 渲染文本和图片
- 集成 `react-markdown`、`remark-gfm`、代码高亮
- assistant response 支持 rendered / raw 切换
- 实现 base64 / data URL 图片探测
- 实现缩略图和放大预览
- 超长文本折叠、展开、复制

验收：

- Markdown 标题、列表、表格、代码块可正确渲染
- request 中 data URL 图片可预览
- 长文本和大图不会阻塞列表滚动

### Phase 6：搜索、过滤、排序

目标：能快速定位失败调用和关键词命中记录。

任务：

- Rust 实现流式字符串搜索
- 搜索结果包含 line number、匹配上下文
- 前端实现搜索面板
- 实现 model、provider、status、only error、with image、with tool call 过滤
- 实现 latency / token 阈值过滤
- 实现按时间、latency、tokens、model、status 排序

验收：

- 能搜索 request / response / error / raw JSON
- 能过滤错误调用
- 搜索结果点击后跳转到对应记录

### Phase 7：打磨与发布准备

目标：达到可分发试用质量。

任务：

- 增加扫描进度和取消扫描
- 增加最近打开文件
- 增加快捷键
- 完善错误处理
- 增加示例日志文件
- 增加 README 使用说明
- 配置 Tauri 打包
- 性能测试 100MB / 10 万行 JSONL

验收：

- 100MB JSONL 文件可打开
- 打开和扫描过程 UI 不冻结
- 不联网、不上传数据
- 能完成打开、过滤、查看、搜索、预览图片的主流程

## 5. v0.1 任务优先级

P0 必须完成：

- Tauri 桌面应用骨架
- JSONL 流式扫描
- LogSummary 列表
- 虚拟滚动
- 单条记录懒读取
- JSON Tree
- generic adapter
- OpenAI adapter
- Conversation View
- Markdown 渲染
- data URL 图片预览
- 基础搜索
- 错误过滤

P1 建议完成：

- 最近文件
- 扫描进度和取消
- tool call 独立展示
- 复制 request / response / assistant text
- 主题设置
- 快捷键

P2 可延期：

- Anthropic / Gemini / Ollama 完整 adapter
- 两条记录 diff
- 统计面板 P95
- 脱敏导出
- SQLite 缓存
- 文件追加监听

## 6. 开发顺序建议

推荐按“数据通路先闭环，再增强体验”的顺序开发：

1. 先跑通 `open file -> scan -> list -> select -> raw detail`
2. 再做 `raw detail -> normalized -> conversation`
3. 再补 Markdown、图片和 tool call
4. 再做搜索、过滤和排序
5. 最后做性能、快捷键、最近文件和打包

这样每个阶段都有可运行产物，也能尽早验证 Rust 文件扫描和前端大列表性能。

## 7. 测试计划

### 7.1 单元测试

Rust：

- JSONL 空行处理
- 非法 JSON 行处理
- byte offset 正确性
- summary 字段提取
- adapter 识别和归一化
- base64 / data URL 图片识别

TypeScript：

- filter predicate
- sort comparator
- normalized content renderer
- 大字段折叠逻辑

### 7.2 集成测试

- 打开推荐内部日志格式
- 打开最小兼容格式
- 打开包含非法行的 JSONL
- 打开包含 base64 图片的 JSONL
- 打开 OpenAI Chat Completions 样例
- 搜索命中并跳转记录

### 7.3 性能测试

准备三类样例：

- 1MB 小文件，用于快速回归
- 100MB 大文件，用于 MVP 验收
- 10 万行短记录，用于虚拟列表和索引测试

验收指标：

- 扫描时 UI 可交互
- 列表滚动无明显卡顿
- 单条记录懒加载不批量解析全文件
- base64 图片只在当前记录需要时预览

## 8. 关键风险与控制

### 风险 1：MVP 过早扩展成观测平台

控制：

- v0.1 只做单文件本地查看
- 不做账号、云、团队、SDK、服务端
- Conversation / Markdown / 图片优先于统计平台能力

### 风险 2：provider 格式过多导致延期

控制：

- v0.1 以 generic + OpenAI 为主
- Anthropic / Gemini / Ollama 可先做轻量识别
- 未识别格式必须 fallback 到 raw JSON 和 preview

### 风险 3：大文件性能不达标

控制：

- 扫描阶段只提取摘要
- 详情阶段按 offset 懒读取单行
- 前端列表必须虚拟滚动
- base64 和大字段默认折叠
- v0.1 不做全量深度索引

### 风险 4：图片预览导致内存过高

控制：

- 不批量解码图片
- 设置最大自动预览大小
- 对超大图片显示手动加载提示
- 图片只保留在当前记录展示状态中

## 9. 交付物清单

v0.1 完成时应包含：

- 可运行 Tauri 桌面应用
- README
- 示例 JSONL 日志
- 基础开发脚本
- Rust 单元测试
- 前端关键逻辑测试
- 100MB 测试文件生成脚本
- 打包说明

## 10. 后续版本路线

### v0.2 Debugger

- 记录 diff
- tool call 专用视图
- error 专用视图
- 文件级统计面板
- 复制 / 导出单条记录
- 更多 provider adapter

### v0.3 Local Workspace

- 多文件标签页
- SQLite 索引缓存
- 文件追加监听
- 搜索索引
- 成本计算
- 自定义 schema mapping
- 脱敏导出

### v0.4 Replay Lab

- 从日志重新发起请求
- 编辑 prompt 和参数
- provider 配置
- 结果对比
- 失败样本集管理

### v1.0

- 跨平台稳定打包
- 插件式 adapter
- 完整文档
- 性能和隐私能力稳定
- 可作为真实 AI Native App 开发工作流中的本地审计工具
