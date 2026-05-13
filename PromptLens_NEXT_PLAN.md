# PromptLens 下一阶段优化与开发计划

## 1. 当前状态

当前代码已经达到 v0.1 MVP 功能闭环，并已推进一轮稳定化：

- Tauri + React + TypeScript + Rust 桌面应用骨架
- 本地 JSONL 文件打开
- Rust 流式扫描、行号和 byte offset 索引
- 调用摘要列表和虚拟滚动
- 单条记录懒加载
- generic / OpenAI 风格基础归一化
- Conversation View
- Markdown 渲染
- data URL / base64 图片预览
- Metadata / JSON Tree / Search 右侧面板
- 基础过滤、排序、阈值筛选
- 最近文件、主题切换、快捷键
- README、示例日志、样例生成脚本
- Rust 核心单元测试
- 搜索结果上限保护
- Tool / Error / Raw 专用调试面板
- JSON Tree key/value 过滤和 JSON path 复制
- 两条记录 diff 基线流程
- provider fixtures：OpenAI、Anthropic、Gemini、Ollama

当前阶段结论：v0.2 Debugger Foundation 已基本具备内部试用价值；后续应转入真实大文件性能验收、扫描进度/取消和打包发布验证。

## 2. 主要问题分析

### 2.1 后端结构需要拆分

当前 Rust 逻辑集中在 `src-tauri/src/lib.rs`，已经包含 command、扫描、搜索、adapter、图片识别、数据模型等多种职责。继续扩展 Anthropic / Gemini / Ollama adapter 或测试会让文件快速失控。

影响：

- adapter 难以单元测试
- search / scan / normalize 修改互相干扰
- 后续 SQLite 缓存、取消扫描、进度事件难以接入

### 2.2 前端组件需要模块化

当前主要 UI 集中在 `src/app/App.tsx`，包含 toolbar、列表、conversation、JSON Tree、search、metadata、快捷键和状态管理。

影响：

- UI 迭代时容易引入回归
- JSON Tree、SearchPanel、LogList 无法独立测试
- v0.2 diff / tool view 会进一步放大复杂度

### 2.3 大文件性能还缺少真实验证

目前实现采用流式扫描和虚拟列表，方向正确，但尚未完成 100MB / 10 万行真实文件验收。

风险点：

- scan 结束前一次性返回所有 summaries，100MB 可接受，但 1GB 不可持续
- 搜索结果无限制返回，极端关键词可能返回过多结果
- JSON Tree 对超大单条记录仍可能有渲染压力

### 2.4 Adapter 覆盖不足

当前 generic / OpenAI 风格可以处理推荐格式和常见 Chat Completions 结构，但对以下格式支持还不足：

- OpenAI Responses API 的 `output[]`
- Anthropic Messages 的 `content[]`
- Gemini 的 `contents[] / parts[]`
- Ollama 的 chat/generate 返回
- tool call 和 tool result 的供应商差异

### 2.5 JSON Tree 仍是基础版

当前 JSON Tree 可展开、截断和复制值，但还缺少：

- key/value 搜索
- 复制 JSON path
- 复制子树 JSON
- base64 字段更明确的安全展示
- 跳转到 raw JSON 字段

## 3. 下一阶段目标

建议下一阶段定义为 **v0.1 Stabilization + v0.2 Debugger Foundation**。

目标：

1. 让 v0.1 达到可公开试用质量
2. 建立后续 v0.2 功能所需的模块边界
3. 用测试固定 scanner、adapter、image detector 的行为
4. 验证 100MB / 10 万行性能目标
5. 补齐主流 provider adapter 的基础能力

## 4. 里程碑计划

### Phase A：工程结构重构

目标：拆分职责，不改变现有用户行为。

后端拆分：

```text
src-tauri/src/
  lib.rs
  commands/
    mod.rs
    file.rs
    scan_jsonl.rs
    read_record.rs
    search.rs
  models/
    mod.rs
    file.rs
    summary.rs
    normalized.rs
    search.rs
  parser/
    mod.rs
    summary.rs
    image_detector.rs
  adapters/
    mod.rs
    generic.rs
    openai.rs
    anthropic.rs
    gemini.rs
    ollama.rs
```

前端拆分：

```text
src/
  app/App.tsx
  features/
    toolbar/
    log-list/
    conversation/
    json-tree/
    search/
    metadata/
  lib/
    format.ts
    clipboard.ts
    recentFiles.ts
  types/
    log.ts
```

验收：

- `npm run build` 通过
- `cargo fmt --check && cargo check` 通过
- 功能行为与当前版本一致

### Phase B：测试与样例体系

目标：用自动化测试保护核心解析逻辑。

任务：

- Rust scanner 单元测试
- byte offset 单元测试
- invalid JSON 单元测试
- image detector 单元测试
- generic adapter 单元测试
- OpenAI Chat Completions adapter 单元测试
- 增加 provider fixture JSONL
- 增加 100MB 样例生成参数说明

验收：

- `cargo test` 通过
- fixtures 覆盖推荐格式、最小格式、OpenAI、非法行、图片字段

### Phase C：Adapter 增强

目标：让 PromptLens 真正具备 LLM 日志语义识别能力。

优先级：

1. OpenAI Chat Completions 完整化
2. OpenAI Responses API 基础支持
3. Anthropic Messages 基础支持
4. Gemini 基础支持
5. Ollama 基础支持
6. Custom generic fallback 强化

重点字段：

- request messages
- response text/messages
- tool calls
- tool results
- usage
- latency
- error
- provider metadata

验收：

- 每个 adapter 至少有 2 个 fixture
- 未识别结构仍能展示 preview 和 raw JSON

### Phase D：性能与稳定性

目标：完成 PRD 中 v0.1 性能验收。

任务：

- 生成 100MB JSONL 测试文件
- 生成 10 万行 JSONL 测试文件
- 搜索结果增加上限和提示
- JSON Tree 大对象初始层级限制
- 扫描期间增加进度事件
- 支持取消扫描
- 记录扫描耗时和详情加载耗时

验收：

- 100MB 文件可打开
- 10 万行列表滚动可用
- 搜索不会因海量命中卡死 UI
- 当前记录详情加载保持懒解析

### Phase E：Debugger 体验基础

目标：为 v0.2 diff / tool / error 专用调试体验铺路。

任务：

- Tool Calls tab
- Error tab
- Raw Request / Raw Response tab
- 复制 request JSON
- 复制 response JSON
- 复制 assistant text
- JSON Tree 搜索 key/value
- 复制 JSON path
- 复制子树 JSON

验收：

- 开发者能在不看完整 raw JSON 的情况下定位 tool call 和 error
- 常用复制动作不需要手动选中文本

## 5. 优先级

P0：

- 后端模块拆分
- 前端模块拆分
- Rust parser / adapter 单元测试
- 100MB / 10 万行性能验收
- 搜索结果上限
- OpenAI adapter 完整化

P1：

- Anthropic / Gemini / Ollama 基础 adapter
- 扫描进度和取消
- JSON Tree 搜索和复制 path
- Tool Calls / Error 专用 tab
- 复制 request / response / assistant text

P2：

- 两条记录 diff
- 脱敏导出
- SQLite 索引缓存
- 文件追加监听
- 成本计算

## 6. 建议开发顺序

1. 先做 Phase A 重构，保证后续改动有清晰边界
2. 紧接 Phase B 测试，把现有行为固定住
3. 做 Phase C adapter，提升真实日志兼容率
4. 做 Phase D 性能验收和稳定性优化
5. 最后做 Phase E 调试体验，进入 v0.2

## 7. 版本出口

### v0.1.1 Stabilization

- 模块拆分完成
- 核心单元测试完成
- 100MB / 10 万行验证通过
- README 完善
- 小范围试用

### v0.2 Debugger

- Tool Calls / Error / Raw Request / Raw Response 专用视图
- 更多 provider adapter
- 复制能力完善
- JSON Tree 搜索和 path 操作
- 初版 record diff

### v0.3 Local Workspace

- 多文件标签页
- SQLite 索引缓存
- 增量监听
- 搜索索引
- 脱敏导出
