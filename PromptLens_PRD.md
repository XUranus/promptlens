# PromptLens PRD

## 1. 产品概述

### 1.1 产品名称

**PromptLens**

### 1.2 一句话定位

PromptLens 是一款面向 AI Native App 开发者的本地优先 LLM 调用审计日志查看器，用于高效查看、检索、渲染和分析 JSONL 格式的 LLM 请求与响应记录。

### 1.3 产品愿景

在 AI Native App 开发过程中，开发者会频繁记录 LLM 调用的 request、response、tool call、token usage、latency、error、base64 图片等审计信息。这些信息通常以 JSONL 文件保存，内容结构复杂、体积较大、可读性差。

PromptLens 的目标是成为 AI Native App 开发者的本地调试基础设施，让开发者像使用 SQLite Browser 查看数据库、像使用 Postman 调试 HTTP 请求一样，轻松查看和分析 LLM 调用日志。

### 1.4 产品定位

PromptLens 不是普通 JSON Viewer，也不是完整的云端 LLM Observability 平台。

它的定位是：

> 本地优先、文件优先、JSONL 优先、LLM 语义优先的 Prompt / Trace / Audit Viewer。

核心差异化：

- 专注 LLM 调用日志，而非通用 JSON 文件
- 支持 JSONL 大文件流式读取
- 支持 LLM messages 对话渲染
- 支持 Markdown 渲染
- 支持 base64 图片预览
- 支持 request / response / tool call / usage / error 结构化查看
- 支持完全本地运行，保护隐私
- 支持多模型供应商日志格式适配

---

## 2. 背景与问题

### 2.1 背景

AI Native App 开发者在调试应用时，通常会保存 LLM 调用记录作为审计日志。常见保存方式是将每次调用的请求和返回写入 JSONL 文件：

```json
{"timestamp":"2026-05-13T10:00:00Z","model":"gpt-4.1","request":{...},"response":{...},"usage":{...}}
{"timestamp":"2026-05-13T10:01:12Z","model":"qwen-vl","request":{...},"response":{...},"error":null}
```

这种方式简单、可靠、便于追加写入，但查看体验很差。

### 2.2 当前痛点

#### 2.2.1 JSONL 不适合人工直接阅读

JSONL 每一行都是一条 JSON 记录，通常没有格式化。开发者需要手动复制某一行到 JSON Formatter 才能查看结构，操作成本高。

#### 2.2.2 LLM 日志层级深、字段多

一次 LLM 调用可能包含：

- system prompt
- user prompt
- assistant response
- tool call
- tool result
- 多轮 messages
- 多模态图片输入
- usage
- latency
- error stack
- provider metadata

普通 JSON Viewer 只能展示树形结构，无法理解 LLM 调用语义。

#### 2.2.3 Markdown 内容无法渲染

LLM 返回内容通常是 Markdown，包括标题、列表、代码块、表格、diff、Mermaid 等。原始字符串不适合阅读和调试。

#### 2.2.4 base64 图片无法预览

多模态请求常把图片以 base64 或 data URL 形式放入 request。普通日志查看器无法直接预览图片，导致排查 OCR、VLM、图片理解类问题非常困难。

#### 2.2.5 大文件打开困难

LLM 调用日志可能快速增长到几十 MB、几百 MB甚至更大。传统方式一次性加载整个文件容易卡顿、崩溃或占用大量内存。

#### 2.2.6 隐私敏感，不适合上传到在线工具

LLM 日志可能包含：

- API Key
- 用户输入
- 私有业务数据
- 图片
- system prompt
- 内部工具调用参数
- 发票、截图、聊天记录等敏感内容

因此开发者需要一个完全本地运行、不上传数据的查看器。

---

## 3. 用户与场景

### 3.1 目标用户

#### 核心用户

AI Native App 独立开发者、小团队开发者、Agent 应用开发者。

典型特征：

- 使用 OpenAI-compatible API、Anthropic、Gemini、DashScope、Ollama、本地模型等
- 会保存 LLM 调用审计日志
- 需要调试 prompt、tool call、多模态输入输出
- 重视本地隐私
- 不想为轻量调试部署完整 observability 平台

#### 次级用户

- 后端开发者
- Prompt Engineer
- AI 产品开发者
- 本地模型 / OCR / VLM 应用开发者
- 需要分析 LLM 调用质量和失败样本的开发者

### 3.2 典型使用场景

#### 场景 1：查看某次失败调用

开发者发现 AI App 输出异常，打开当天的 JSONL 日志，过滤 `error != null` 或按状态筛选失败调用，查看 request、response、error stack 和 provider 原始返回。

#### 场景 2：调试 Markdown 输出

开发者想查看 assistant 返回的 Markdown 是否符合预期。PromptLens 将原始 Markdown 渲染为阅读视图，并支持 raw / rendered 切换。

#### 场景 3：调试多模态 OCR / VLM 调用

开发者在 request 中传入 base64 图片。PromptLens 自动识别图片字段并生成缩略图，点击可放大查看，用于确认模型实际看到的图片是否正确。

#### 场景 4：分析 token 和 latency

开发者想知道某个功能 token 消耗高的原因。PromptLens 按模型、接口、时间、token、latency 聚合展示，快速定位高成本调用。

#### 场景 5：对比两次调用结果

开发者修改 prompt 后，希望对比前后 response 差异。PromptLens 支持选择两条记录，查看 prompt diff、response diff、usage 差异。

#### 场景 6：导出可分享的脱敏 bug report

开发者想把某次调用发给协作者排查，但日志里有敏感信息。PromptLens 支持隐藏 API key、base64 图片、system prompt 等敏感内容后导出。

---

## 4. 产品目标

### 4.1 MVP 目标

在第一版中，PromptLens 需要解决最核心的查看问题：

1. 能打开本地 JSONL 文件
2. 能流式读取大文件，不明显卡顿
3. 能显示每条 LLM 调用摘要
4. 能将 request / response 按 LLM 对话结构渲染
5. 能渲染 Markdown
6. 能识别并预览 base64 图片
7. 能展示原始 JSON Tree
8. 能搜索和过滤日志
9. 能保护本地隐私，不上传任何数据

### 4.2 非目标

MVP 阶段暂不做：

- 云端同步
- 团队协作
- 用户账号
- SDK 接入
- 服务端部署
- Prompt 管理平台
- Eval 系统
- 完整 trace graph
- OpenTelemetry 集成
- 长期生产监控平台
- 多项目权限系统

---

## 5. 产品边界

### 5.1 PromptLens 是什么

PromptLens 是：

- 本地桌面应用
- JSONL 审计日志查看器
- LLM 调用调试工具
- Prompt / Response / Tool Call Inspector
- 多模态输入预览工具
- 轻量本地 trace viewer

### 5.2 PromptLens 不是什么

PromptLens 不是：

- 普通 JSON Formatter
- 在线日志平台
- 完整 APM 系统
- Langfuse / LangSmith 的完整替代品
- 生产环境监控平台
- LLM Gateway
- API 代理服务

---

## 6. 核心功能需求

## 6.1 文件打开与管理

### 6.1.1 打开 JSONL 文件

用户可以通过以下方式打开文件：

- 文件选择器打开 `.jsonl`
- 拖拽文件到窗口
- 最近打开文件列表
- 命令行参数打开文件，后续版本支持

### 6.1.2 文件基本信息展示

打开文件后，展示：

- 文件名
- 文件路径
- 文件大小
- 总行数
- 成功解析条数
- 解析失败条数
- 最近修改时间

### 6.1.3 多文件支持

MVP 可先支持单文件查看。后续版本支持多文件标签页。

---

## 6.2 JSONL 解析与索引

### 6.2.1 按行解析

每一行视为一条日志记录。对于空行，自动跳过。对于非法 JSON 行，记录解析错误并在列表中标记。

### 6.2.2 懒加载完整 JSON

首次打开文件时，不应完整解析所有深层 JSON。应优先提取摘要字段，点击某条记录后再解析完整内容。

### 6.2.3 轻量索引

索引字段包括：

- line number
- byte offset
- timestamp
- provider
- model
- status
- latency
- prompt tokens
- completion tokens
- total tokens
- error flag
- has image
- has tool call
- response preview

### 6.2.4 大文件支持

MVP 目标：

- 100MB JSONL 文件可打开
- 10 万行以内可用
- 打开过程中 UI 不冻结
- 支持取消扫描

后续目标：

- 支持 1GB 级别日志
- 支持 SQLite 索引缓存
- 支持增量监听文件追加

---

## 6.3 调用列表

### 6.3.1 列表字段

左侧调用列表展示：

- 时间
- model
- provider
- status
- latency
- total tokens
- error 标记
- image 标记
- tool call 标记
- 简短预览

示例：

```text
18:03:12  gpt-4.1      8.2s   1.8k tokens   ok      image
18:04:22  qwen-vl      3.1s   900 tokens    error   image
18:05:10  claude       12.4s  4.2k tokens   ok      tool
```

### 6.3.2 虚拟滚动

列表必须支持虚拟滚动，避免大量记录导致前端卡顿。

### 6.3.3 排序

支持按以下字段排序：

- 时间
- latency
- total tokens
- prompt tokens
- completion tokens
- model
- status

### 6.3.4 过滤

支持过滤：

- model
- provider
- status
- only error
- only success
- only with image
- only with tool call
- latency threshold
- token threshold

---

## 6.4 LLM 对话视图

### 6.4.1 messages 渲染

中间主区域将 request 中的 messages 渲染为对话形式。

支持角色：

- system
- developer
- user
- assistant
- tool
- function
- unknown

每个 message card 展示：

- role
- content
- token 估算，可选
- 是否包含图片
- 是否包含 tool call
- copy 按钮
- raw 按钮

### 6.4.2 多内容类型支持

支持 OpenAI 风格 content array：

```json
[
  {"type": "text", "text": "..."},
  {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
]
```

支持文本、图片、tool call、tool result 等类型。

### 6.4.3 长文本折叠

对于很长的 prompt 或 response：

- 默认展示前若干行
- 支持展开全文
- 支持复制全文
- 支持跳转到 raw JSON 字段

---

## 6.5 Markdown 渲染

### 6.5.1 Rendered / Raw 切换

assistant response 默认以 Markdown 渲染，同时支持切换到原始文本。

### 6.5.2 Markdown 能力

MVP 支持：

- heading
- paragraph
- bold / italic
- list
- table
- blockquote
- code block
- inline code
- task list
- link
- horizontal rule

后续支持：

- Mermaid
- LaTeX
- diff 高亮
- diagram preview

### 6.5.3 代码块体验

代码块支持：

- 语言识别
- 语法高亮
- 一键复制
- 横向滚动
- 展开/折叠

---

## 6.6 图片识别与预览

### 6.6.1 base64 图片识别

自动识别以下格式：

```text
data:image/png;base64,...
data:image/jpeg;base64,...
data:image/webp;base64,...
```

也尝试识别纯 base64 图片字符串。

### 6.6.2 常见字段识别

重点识别以下字段：

- image_url.url
- input_image.image_url
- content[].image_url.url
- content[].source.data
- request.messages[].content[]
- response.output[]
- custom payload 中的 image / image_base64 / screenshot 字段

### 6.6.3 图片预览

支持：

- 缩略图展示
- 点击放大
- 查看图片尺寸
- 查看 MIME type
- 复制 base64
- 另存图片，后续版本

### 6.6.4 图片安全策略

默认不将图片写入外部文件。可使用内存缓存或应用内部临时缓存。

---

## 6.7 JSON Tree 视图

### 6.7.1 原始 JSON 展示

右侧展示当前选中记录的原始 JSON Tree。

支持：

- 展开/折叠
- 搜索 key
- 搜索 value
- 复制字段
- 复制 JSON path
- 复制子树 JSON
- 一键格式化

### 6.7.2 大字段折叠

对于超长字段：

- 默认折叠
- 显示长度
- 点击展开
- base64 字段默认不全文展开

### 6.7.3 JSON Path 跳转

从对话视图中的某个 message 可以跳转到对应 raw JSON 字段。

---

## 6.8 搜索

### 6.8.1 全文搜索

支持在当前文件中搜索：

- request text
- response text
- error
- tool name
- model
- provider
- metadata

MVP 可采用简单字符串搜索。后续可加入 Tantivy / SQLite FTS。

### 6.8.2 搜索结果展示

搜索结果展示：

- 所在行
- 匹配字段
- 匹配上下文
- 点击跳转到记录

### 6.8.3 搜索范围

支持选择搜索范围：

- all
- request only
- response only
- error only
- raw JSON
- current record

---

## 6.9 统计面板

### 6.9.1 文件级统计

展示当前文件的整体统计：

- 总调用数
- 成功数
- 失败数
- 平均 latency
- P95 latency，后续版本
- 总 tokens
- prompt tokens
- completion tokens
- 按 model 分布
- 按 provider 分布

### 6.9.2 记录级 metadata

当前记录展示：

- timestamp
- provider
- model
- endpoint
- latency
- status
- token usage
- cost，后续可配置价格表
- request id
- trace id
- error type

---

## 6.10 对比功能

### 6.10.1 两条记录对比

用户可以选择两条记录进行对比。

对比内容：

- request diff
- system prompt diff
- user prompt diff
- assistant response diff
- token usage diff
- latency diff
- model diff
- parameters diff

### 6.10.2 MVP 处理

对比功能可以放在 v0.2，不作为 v0.1 必须项。

---

## 6.11 导出与脱敏

### 6.11.1 复制能力

支持复制：

- request JSON
- response JSON
- assistant text
- rendered markdown source
- current record raw JSON
- selected JSON subtree

### 6.11.2 脱敏导出

后续版本支持导出脱敏后的 bug report。

可脱敏内容：

- API key
- Authorization header
- system prompt
- base64 image
- user private text
- email
- phone
- file path
- custom secret fields

### 6.11.3 导出格式

支持：

- Markdown
- JSON
- JSONL
- HTML，后续版本

---

## 7. Provider Adapter 设计

### 7.1 目标

不同 LLM 供应商的 request / response 格式不一致。PromptLens 需要将其归一化为统一的 LLM 调用结构，以便统一展示。

### 7.2 Normalized Schema

```ts
type NormalizedCall = {
  id: string
  lineNumber: number
  timestamp?: string
  provider?: string
  model?: string
  endpoint?: string
  status: "success" | "error" | "unknown"
  latencyMs?: number
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  request?: {
    messages?: NormalizedMessage[]
    raw?: unknown
  }
  response?: {
    text?: string
    messages?: NormalizedMessage[]
    toolCalls?: NormalizedToolCall[]
    raw?: unknown
  }
  error?: {
    message?: string
    type?: string
    stack?: string
    raw?: unknown
  }
  metadata?: Record<string, unknown>
  raw: unknown
}

type NormalizedMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool" | "function" | "unknown"
  content: NormalizedContent[]
  raw?: unknown
}

type NormalizedContent =
  | { type: "text"; text: string }
  | { type: "image"; mime?: string; dataUrl?: string; base64?: string }
  | { type: "tool_call"; name?: string; arguments?: unknown }
  | { type: "tool_result"; name?: string; result?: unknown }
  | { type: "unknown"; raw: unknown }
```

### 7.3 内置 Adapter

MVP 优先支持：

1. OpenAI Chat Completions
2. OpenAI Responses API
3. OpenAI-compatible API
4. Anthropic Messages
5. Gemini
6. Ollama
7. Custom generic fallback

### 7.4 Generic Fallback

对于未知格式，PromptLens 应该尽量自动识别：

- timestamp
- model
- messages
- request
- response
- usage
- error
- image fields
- text fields

如果无法识别，则仍然提供 JSON Tree 查看能力。

---

## 8. 交互与界面设计

### 8.1 主界面布局

采用三栏布局：

```text
┌──────────────┬─────────────────────────────┬──────────────────────┐
│ 调用列表      │ 对话 / Markdown / 图片预览    │ JSON Tree / Metadata  │
│              │                             │                      │
│ 时间          │ system                      │ model                │
│ model        │ user                        │ token                │
│ status       │ image preview               │ latency              │
│ latency      │ assistant markdown           │ raw request          │
│ token        │ tool call                    │ raw response         │
└──────────────┴─────────────────────────────┴──────────────────────┘
```

### 8.2 顶部工具栏

包含：

- Open File
- Recent Files
- Search
- Filter
- Statistics
- Theme Toggle
- Settings

### 8.3 左侧列表

用于快速定位调用记录。

### 8.4 中间主视图

用于阅读 LLM 调用内容。

包含 tab：

- Conversation
- Response
- Images
- Tool Calls
- Diff，后续版本

### 8.5 右侧详情视图

包含 tab：

- Metadata
- JSON Tree
- Raw Request
- Raw Response
- Error

### 8.6 设计风格

建议采用现代桌面工具风格：

- 支持深色 / 浅色模式
- 低干扰 UI
- 高信息密度
- 类 macOS 工具应用质感
- 支持键盘快捷键
- 支持可拖拽调整面板宽度

---

## 9. 技术方案

## 9.1 技术栈

### 桌面框架

- Tauri

### 后端

- Rust

### 前端

- React
- TypeScript
- Vite

### 状态管理

- Zustand

### UI

- shadcn/ui 或自定义组件
- Tailwind CSS

### Markdown 渲染

- react-markdown
- remark-gfm
- rehype-highlight 或 shiki

### JSON Tree

候选：

- react-json-view-lite
- json-edit-react
- 自研只读 JSON Tree，后续考虑

### 虚拟列表

- @tanstack/react-virtual

### Rust 依赖

候选：

- serde
- serde_json
- tokio
- base64
- infer
- memmap2，可选
- rusqlite，可选
- tantivy，后续可选

---

## 9.2 后端模块

```text
src-tauri/
  src/
    main.rs
    commands/
      open_file.rs
      scan_jsonl.rs
      read_record.rs
      search.rs
      export.rs
    parser/
      jsonl.rs
      adapter.rs
      image_detector.rs
    adapters/
      openai.rs
      anthropic.rs
      gemini.rs
      ollama.rs
      generic.rs
    index/
      line_index.rs
      sqlite_cache.rs
    security/
      redactor.rs
```

### 9.2.1 JSONL Scanner

职责：

- 逐行读取文件
- 记录 byte offset
- 解析轻量摘要
- 返回列表数据给前端
- 对非法 JSON 行记录错误

### 9.2.2 Record Reader

职责：

- 根据 line number / byte offset 读取完整记录
- 完整 parse JSON
- 调用 adapter 归一化
- 返回 raw JSON 和 normalized call

### 9.2.3 Image Detector

职责：

- 扫描 JSON 中疑似图片字段
- 判断 data URL / base64
- 提取 MIME type
- 生成前端可显示的 data URL
- 避免一次性解码超大 base64

### 9.2.4 Adapter Engine

职责：

- 根据字段特征判断 provider 格式
- 输出 NormalizedCall
- fallback 到 generic adapter

### 9.2.5 Search Engine

MVP：

- 按行字符串搜索
- 支持大小写选项
- 返回匹配行和上下文

后续：

- SQLite FTS
- Tantivy 全文索引
- 增量索引

---

## 9.3 前端模块

```text
src/
  app/
    App.tsx
    layout/
  features/
    file-open/
    log-list/
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
  components/
    SplitPane.tsx
    Toolbar.tsx
    EmptyState.tsx
    ErrorBoundary.tsx
```

### 9.3.1 Log List

- 虚拟滚动
- 排序
- 过滤
- 状态标记
- 键盘上下选择

### 9.3.2 Conversation View

- role card
- Markdown 渲染
- 图片预览
- tool call 折叠
- raw / rendered 切换

### 9.3.3 JSON Tree

- 只读展示
- 大字段折叠
- 复制 path
- 复制 value
- 搜索 key / value

### 9.3.4 Search Panel

- 输入关键词
- 设置范围
- 展示搜索结果
- 点击跳转

---

## 10. 数据结构

### 10.1 LogSummary

```ts
type LogSummary = {
  id: string
  lineNumber: number
  byteOffset: number
  timestamp?: string
  provider?: string
  model?: string
  status: "success" | "error" | "invalid_json" | "unknown"
  latencyMs?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  hasImage: boolean
  hasToolCall: boolean
  preview?: string
}
```

### 10.2 FileScanResult

```ts
type FileScanResult = {
  filePath: string
  fileName: string
  fileSize: number
  totalLines: number
  validRecords: number
  invalidRecords: number
  summaries: LogSummary[]
}
```

### 10.3 RecordDetail

```ts
type RecordDetail = {
  summary: LogSummary
  normalized: NormalizedCall
  raw: unknown
}
```

---

## 11. 性能要求

### 11.1 MVP 性能目标

在普通开发机器上：

- 100MB JSONL 文件可打开
- 10 万行记录可滚动查看
- 初始扫描不阻塞 UI
- 单条记录点击后 300ms 内尽量显示摘要内容
- 大字段不默认展开
- base64 图片不全量批量解码

### 11.2 性能策略

- Rust 后端流式扫描
- 前端虚拟列表
- 懒解析完整 JSON
- 懒解码图片
- 大字段截断显示
- 后续引入 SQLite 索引缓存
- 后续支持扫描进度和取消

---

## 12. 隐私与安全

### 12.1 本地优先

MVP 必须做到：

- 不上传文件
- 不调用远程服务
- 不默认联网
- 不收集遥测数据
- 不自动发送崩溃日志

### 12.2 敏感字段隐藏

默认检测并提示隐藏：

- authorization
- api_key
- access_token
- refresh_token
- secret
- password
- cookie
- set-cookie

### 12.3 图片隐私

base64 图片默认只在本地内存中预览。导出时默认不包含图片，除非用户显式选择。

### 12.4 脱敏导出

后续版本支持：

- 导出前预览脱敏结果
- 自定义脱敏规则
- 按 JSON path 脱敏
- 按正则脱敏

---

## 13. 设置项

MVP 设置：

- 主题：system / light / dark
- 默认打开视图：Conversation / JSON
- Markdown 默认渲染：on / off
- base64 图片自动预览：on / off
- 最大自动预览图片大小
- 大字段折叠阈值
- 最近文件数量
- 是否记住窗口布局

后续设置：

- Provider adapter 优先级
- 自定义 schema mapping
- 成本价格表
- 脱敏规则
- 快捷键自定义

---

## 14. 快捷键

建议快捷键：

| 快捷键 | 功能 |
|---|---|
| Ctrl/Cmd + O | 打开文件 |
| Ctrl/Cmd + F | 搜索 |
| Ctrl/Cmd + R | 重新扫描 |
| ↑ / ↓ | 切换记录 |
| Enter | 打开当前记录 |
| Ctrl/Cmd + C | 复制当前选中内容 |
| Ctrl/Cmd + Shift + C | 复制当前记录 JSON |
| Ctrl/Cmd + B | 切换侧边栏 |
| Ctrl/Cmd + J | 切换 JSON Tree |
| Ctrl/Cmd + M | 切换 Markdown raw/rendered |
| Esc | 关闭弹窗 / 搜索 |

---

## 15. 版本规划

## 15.1 v0.1 MVP

目标：能舒服地看单个 JSONL LLM 调用日志。

功能：

- 打开 JSONL 文件
- 流式扫描
- 调用列表
- 基础字段摘要
- 单条记录详情
- Conversation View
- Markdown 渲染
- base64 图片预览
- JSON Tree
- 基础搜索
- 基础过滤
- 深浅色主题

验收标准：

- 能打开 100MB JSONL
- 能查看 request / response
- 能渲染 assistant Markdown
- 能预览 request 中的 base64 图片
- 能搜索关键词
- 能过滤错误调用
- 不联网、不上传数据

## 15.2 v0.2 Debugger

目标：增强调试效率。

功能：

- 两条记录 diff
- prompt / response 对比
- tool call 专用视图
- error 专用视图
- 统计面板
- 复制 / 导出单条记录
- 最近文件
- 大字段优化
- 更多 provider adapter

## 15.3 v0.3 Local Workspace

目标：从单文件工具变成本地工作台。

功能：

- 多文件标签页
- 项目管理
- SQLite 索引缓存
- 文件增量监听
- 搜索索引
- 成本计算
- 自定义 schema mapping
- 脱敏导出

## 15.4 v0.4 Replay Lab

目标：从查看器变成调试实验台。

功能：

- 从日志重新发起请求
- 修改 prompt 后 replay
- 参数编辑
- provider 配置
- 结果对比
- prompt version 管理
- 失败样本集管理

## 15.5 v1.0

目标：稳定发布为本地 LLM 调用审计工具。

功能：

- 稳定跨平台打包
- 完整文档
- 插件式 adapter
- 良好的性能
- 良好的隐私保护
- 可用于真实 AI Native App 开发工作流

---

## 16. 成功指标

### 16.1 开发者效率指标

- 查看某条调用的时间从几分钟降低到几秒
- 多模态调用排查效率明显提升
- 失败调用定位更快
- prompt 修改前后对比更容易

### 16.2 产品指标

如果开源：

- GitHub Star
- Issue / PR 数量
- 开发者反馈
- 被其他 AI Native 项目采用

如果商业化：

- 下载量
- 活跃使用次数
- 付费转化
- 团队版本需求

### 16.3 技术指标

- 100MB JSONL 打开稳定
- 大文件滚动不卡顿
- 图片预览成功率高
- 常见 provider 格式识别准确
- 崩溃率低

---

## 17. 风险与应对

### 17.1 风险：变成普通 JSON Viewer

应对：

- 强化 LLM 语义视图
- 优先做 Conversation / Markdown / Image / Tool Call
- JSON Tree 只是辅助，不是主卖点

### 17.2 风险：和 Langfuse 等平台重叠

应对：

- 坚持本地文件优先
- 不做云平台
- 不要求 SDK 接入
- 不做团队协作作为 MVP
- 聚焦开发阶段离线审计

### 17.3 风险：日志格式过多

应对：

- 使用 adapter 架构
- 内置主流 provider
- 提供 generic fallback
- 后续支持用户自定义 mapping

### 17.4 风险：大文件性能不足

应对：

- Rust 流式扫描
- 虚拟列表
- 懒加载
- 大字段折叠
- 后续索引缓存

### 17.5 风险：base64 图片导致内存过高

应对：

- 不批量解码
- 只对当前记录懒解码
- 设置最大预览大小
- 对超大图片提示手动加载

---

## 18. MVP 开发拆分

### Phase 1：项目脚手架

- Tauri + React + TypeScript + Vite 初始化
- 基础布局
- 深浅色主题
- 文件打开命令

### Phase 2：JSONL 扫描

- Rust 按行读取
- 解析摘要
- 返回 LogSummary
- 前端调用列表
- 虚拟滚动

### Phase 3：记录详情

- 点击记录读取完整 JSON
- JSON Tree 展示
- raw JSON 格式化
- 大字段折叠

### Phase 4：LLM 语义渲染

- NormalizedCall schema
- Generic adapter
- OpenAI adapter
- messages 对话视图
- role card

### Phase 5：Markdown 与图片

- Markdown renderer
- raw/rendered 切换
- base64 detector
- 图片缩略图
- 图片预览弹窗

### Phase 6：搜索与过滤

- 基础搜索
- model/status/error 过滤
- token/latency 排序
- 最近文件

### Phase 7：打磨与发布

- 错误处理
- loading/progress
- 空状态
- 快捷键
- 打包
- README
- 示例日志文件

---

## 19. 示例日志格式

### 19.1 推荐内部日志格式

PromptLens 可以提供一种推荐的 JSONL 审计格式，方便用户自己的项目接入。

```json
{
  "id": "call_001",
  "timestamp": "2026-05-13T10:00:00Z",
  "provider": "openai",
  "model": "gpt-4.1",
  "endpoint": "/v1/chat/completions",
  "latency_ms": 8231,
  "request": {
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Please analyze this invoice."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/png;base64,..."
            }
          }
        ]
      }
    ],
    "temperature": 0.2
  },
  "response": {
    "message": {
      "role": "assistant",
      "content": "## Invoice Analysis\n\n..."
    }
  },
  "usage": {
    "prompt_tokens": 1200,
    "completion_tokens": 400,
    "total_tokens": 1600
  },
  "error": null,
  "metadata": {
    "app": "InvoiceVault",
    "env": "dev",
    "trace_id": "trace_xxx"
  }
}
```

### 19.2 最小兼容格式

```json
{
  "timestamp": "2026-05-13T10:00:00Z",
  "model": "gpt-4.1",
  "request": "...",
  "response": "..."
}
```

---

## 20. 未来扩展方向

### 20.1 插件式 Adapter

允许社区为不同 provider 或不同业务日志格式编写 adapter。

### 20.2 Replay

从历史日志中恢复 request，修改 prompt 或参数后重新调用模型。

### 20.3 Dataset Builder

将失败样本、优质样本、边界样本导出为 eval dataset。

### 20.4 Agent Trace Graph

将多步 agent 调用以 timeline / graph 方式展示：

- user input
- planning
- tool call
- tool result
- reflection
- final answer

### 20.5 RAG Debugger

专门展示：

- query
- retrieved chunks
- rerank score
- final context
- response
- hallucination 检查

### 20.6 Cost Center

按项目、模型、时间统计 token 和成本。

### 20.7 自动诊断

用本地规则或 LLM 辅助分析：

- prompt 是否过长
- 是否有重复上下文
- 是否有无效图片
- tool call 是否失败
- response 是否为空
- JSON 输出是否不合法

---

## 21. 总结

PromptLens 的核心价值不是“格式化 JSON”，而是理解 LLM 调用日志的特殊结构，并把它转化成开发者真正可读、可搜、可调试的视图。

MVP 应该坚定聚焦：

- JSONL
- LLM messages
- Markdown
- base64 图片
- raw JSON
- 本地隐私
- 大文件性能

只要第一版把这些体验做好，PromptLens 就会明显区别于普通 JSON Viewer，也不会和 Langfuse、LangSmith、Phoenix 等平台正面竞争。

它最适合作为 AI Native App 开发者的本地调试工具，也是后续扩展为 Replay Debugger、Agent Trace Viewer、RAG Debugger 的良好基础。
