# 系统详细设计报告

## 引言

### 项目背景
本项目是一个面向知识图谱增强问答与案例检索场景的智能问答系统，代码仓库名称为 `QA_GRAPHRAG`。系统以 GraphRAG 检索、LangGraph 智能体编排、CopilotKit 对话运行时为核心，提供统一的聊天问答入口、知识图谱浏览入口、案例提取入口以及案例空间分布可视化能力。

系统由三个主要运行面组成：
- 前端界面：基于 React + Vite，负责聊天交互、线程列表、右侧信息面板、地图与图谱可视化。
- Runtime 中间层：基于 Express + CopilotKit Runtime，负责前端与 LangGraph AG-UI Agent 的协议桥接。
- Agent 服务：基于 FastAPI + LangGraph，负责智能体执行、线程持久化、GraphRAG 数据访问、案例提取与可视化数据接口。

### 系统建设意义与目的
系统目标是将知识图谱检索、智能体多步骤推理、对话历史持久化、案例空间分布分析等能力统一到一个可交互平台中，降低用户使用 GraphRAG 与遥感/生态模型知识库的门槛。

系统的主要价值包括：
- 为用户提供自然语言驱动的知识查询和案例检索入口。
- 将复杂的 GraphRAG 检索、工具调用和中断审核过程封装为可视化对话流程。
- 为案例库提供省、市、县三级空间查看能力和案例详情联动能力。
- 为长对话、多线程、多用户场景提供线程持久化与状态恢复机制。

### 系统设计目标与范围

#### 系统设计目标
系统设计目标如下：
- 可扩展性：支持新增知识仓库、智能体工具、页面入口和可视化能力。
- 可用性：支持线程历史恢复、模型切换、案例地图查看、知识图谱浏览。
- 并发性：支持多用户、多线程并发访问，通过 thread_id 隔离会话。
- 可维护性：前端、Runtime、Agent 三层职责分离，线程元数据与消息持久化独立建模。
- 性能可接受：聊天首屏走 bootstrap 恢复，历史按页加载，图谱与地图内容按需加载。
- 稳定性：对 Runtime 流中断、LangGraph interrupt 上下文丢失、SQLite 并发访问等场景提供兜底处理。

#### 项目范围
当前项目范围包括：
- 登录与本地用户切换。
- 聊天问答与模型切换。
- 线程创建、重命名、删除、恢复、分页历史加载。
- LangGraph 智能体编排与 GraphRAG 检索。
- 人工中断审核（HITL）能力。
- 案例地图可视化、区域分级查看、案例点详情查看。
- GraphRAG 图谱数据与图可视化数据接口。
- 案例提取相关 API 与页面入口。

### 设计原则
系统遵循以下设计原则：
- 前后端分离：React 前端、Node Runtime、Python Agent 服务独立部署。
- 协议桥接：前端不直接耦合 LangGraph，统一通过 CopilotKit Runtime 与 AG-UI 协议接入。
- 会话隔离：所有智能体状态通过 `thread_id` 隔离，不同用户通过 `X-User-Id` 进行访问控制。
- 轻量恢复：线程首屏恢复采用 bootstrap 机制，仅恢复最近一页消息与必要状态。
- 持久化分层：线程摘要、Agent 状态、消息正文分表存储，降低读取成本。
- 按需加载：地图、图谱、Markdown 富内容等重组件按需渲染。
- 单体内分层：当前实现不是微服务拆分，而是在单仓内按职责边界分层组织代码。

---

## 术语和缩略语

| 缩略语 | 英文全称 | 说明 |
|--------|----------|------|
| GraphRAG | Graph Retrieval-Augmented Generation | 基于知识图谱的检索增强生成 |
| LLM | Large Language Model | 大语言模型 |
| AG-UI | Agent UI Protocol | CopilotKit/LangGraph 间的智能体 UI 协议 |
| HITL | Human In The Loop | 人工参与审核/确认机制 |
| WMTS | Web Map Tile Service | 地图瓦片服务协议 |
| SSE | Server-Sent Events | 服务端流式推送机制 |
| WAL | Write-Ahead Logging | SQLite 预写日志模式 |
| KG | Knowledge Graph | 知识图谱 |
| RAG | Retrieval-Augmented Generation | 检索增强生成 |

---

## 系统概述

### 整体架构设计
系统采用“三层运行面 + 持久化层”的整体结构：
- 前端层：负责页面渲染、会话入口、线程侧边栏、聊天区、地图与图谱展示。
- Runtime 层：负责 CopilotKit Runtime 协议服务、模型配置接口、对 Agent 服务的轻量代理。
- Agent 服务层：负责 LangGraph 智能体执行、GraphRAG 数据访问、线程历史与状态 API。
- 数据层：以 SQLite 为主，存储聊天线程、LangGraph checkpoint、Agent 状态、GraphRAG 结果和地理案例数据；Parquet 文件用于图谱可视化数据读取。

逻辑调用链如下：
1. 前端通过 `runtimeUrl=/copilotkit` 与 Runtime 通信。
2. Runtime 将智能体请求转发给 FastAPI 暴露的 AG-UI Agent 端点。
3. Agent 调用 LangGraph 工作流、LLM、GraphRAG 查询、案例工具等。
4. 结果经 Runtime 回传前端，同时线程数据落库以便恢复。

### 分层架构设计

#### 展示层
展示层由 `src/` 目录承担，主要职责包括：
- 登录与本地用户管理。
- 聊天工作区布局与线程侧边栏。
- 右侧信息面板、案例详情面板。
- 知识图谱浏览页面与案例提取页面。
- 地图可视化、Markdown 渲染、模型选择器、人工中断卡片等组件。

#### 应用服务层
应用服务层由 Runtime 与 FastAPI API 共同构成：
- Runtime 负责 CopilotKit 协议接入、模型切换接口、轻量历史 bootstrap 转发。
- FastAPI 负责线程管理、历史分页、GraphRAG 可视化数据、案例提取、LLM 配置接口等。

#### 业务逻辑层
业务逻辑层由 LangGraph 智能体工作流和 GraphRAG 工具集承担，主要包括：
- 意图路由。
- 本地检索与全局检索。
- 参数问答与案例分布查询。
- 人工审核中断与恢复。
- 结果综合与 UI 状态生成。

#### 数据访问层
数据访问层主要包括：
- SQLite：聊天线程元数据、线程消息、Agent 状态、LangGraph checkpoints、GraphRAG 结果。
- Parquet：GraphRAG 实体、关系、社区、文档等离线图谱产物。
- 浏览器 localStorage：本地用户会话与线程列表快照缓存。

---

## 核心业务流程

### 用户交互流程
用户交互流程如下：
1. 用户在首页登录，前端在 `localStorage` 中记录当前用户。
2. 用户进入聊天页面，选择已有线程或创建新线程。
3. 新线程场景下，前端先发送首条消息，再向后端写入线程元数据。
4. 已有线程场景下，Runtime 触发 `loadAgentState`，后端返回 bootstrap 数据恢复最近消息与状态。
5. 用户继续提问，智能体流式返回文本、状态、地图或 GraphRAG 结果。
6. 用户可点击侧边栏线程切换、地图区域、案例点、GraphRAG 按钮进入不同详情面板。

### 智能体交互流程
智能体交互流程如下：
1. 前端将用户消息发送到 CopilotKit Runtime。
2. Runtime 将请求转发到 FastAPI 注册的 AG-UI LangGraph Agent。
3. LangGraph 根据当前状态执行意图路由。
4. 根据用户问题调用相应工具，例如 GraphRAG local/global search、案例地理分布查询等。
5. 智能体在执行过程中通过 `copilotkit_emit_state` 推送步骤状态。
6. 若流程要求人工审核，则通过 `interrupt` 机制挂起并等待前端输入。
7. 智能体汇总结果，拼接可视化数据标记并返回消息。
8. 线程消息、Agent 状态和摘要信息持久化到 SQLite。

---

## 通信协议设计

### 多协议机制
当前系统实际使用的是“REST + CopilotKit/AG-UI 流式协议”的组合，并未实现独立的 WebSocket 通道。设计上可分为三类通信：
- 普通 REST 请求：线程管理、图谱数据、案例提取、模型配置等。
- CopilotKit Runtime 请求：前端与 Runtime 的智能体交互请求。
- 流式智能体响应：LLM/Agent 执行过程中通过 CopilotKit / LangGraph 协议向前端持续推送状态与输出。

### 无状态请求
无状态请求主要用于：
- `/threads` 线程列表查询、创建、更新、删除。
- `/threads/{thread_id}/messages` 历史消息分页。
- `/threads/{thread_id}/bootstrap` 首屏恢复。
- `/api/llm/*` 模型查询与切换。
- `/api/graphrag/*` 图谱和可视化数据查询。
- 案例提取与案例详情相关接口。

REST 接口通过 `X-User-Id` 头部传递当前用户身份，实现轻量用户隔离。

### 实时通信
当前实现未引入独立 WebSocket 通道。模板中的 WebSocket 章节在本项目中对应为“未采用”。

未采用原因包括：
- 当前前端已经通过 CopilotKit Runtime 接收流式结果和状态。
- 线程列表、历史恢复、案例详情等请求均适合 REST。
- 额外引入 WebSocket 会增加连接管理与状态同步复杂度，而当前收益有限。

### 流式响应
系统支持流式响应，主要体现在：
- 智能体调用 LLM 时支持 streaming。
- Agent 在执行过程中通过 `copilotkit_emit_state` 推送步骤状态。
- Runtime 对 loadAgentState 做轻量化拦截，将线程恢复优化为 bootstrap 请求。
- 对流式传输异常提供 fallback：若 streaming 失败，则退回非 streaming 调用。

---

## 并发与状态管理

### 多用户并发机制
系统的多用户并发机制包括：
- 前端用户身份保存在浏览器 `localStorage`，通过用户 ID 区分本地会话。
- 每次 API 请求自动附带 `X-User-Id`，后端按用户 ID 校验线程访问权限。
- LangGraph 侧以 `thread_id` 作为状态隔离键，同一数据库支持多个线程并发执行。
- `SessionGraphManager` 为活跃会话维护独立图实例，但共享同一个 SQLite checkpointer。

### 状态一致性
系统状态分为三类：
- 前端临时状态：当前页面 UI 状态、线程切换状态、Drawer 开关等。
- 后端持久状态：`thread_metadata`、`thread_messages`、`thread_agent_state`、`checkpoints`。
- 浏览器缓存状态：用户信息、线程列表快照。

一致性策略如下：
- 线程列表以后端为权威源，本地缓存仅作不可达时回显。
- 聊天首屏恢复采用 bootstrap，一次获取线程存在性、Agent 状态和最近消息。
- 历史消息通过独立消息表分页，不依赖重放整个 checkpoint。
- 每次消息写入后同步线程摘要字段，确保线程列表和恢复接口读取成本可控。

---

## 模块详细设计

### 前端设计

#### 技术选型
前端采用以下技术栈：
- React 18
- TypeScript
- Vite
- React Router
- TanStack React Query
- CopilotKit React Core / React UI
- Leaflet / React-Leaflet
- React Markdown
- D3 Geo
- Fuse.js

技术选型原因：
- React + TypeScript 便于构建复杂交互和组件复用。
- React Query 适合线程列表、历史分页、地图数据等服务端状态管理。
- CopilotKit 提供聊天运行时与 AG-UI 协议对接能力。
- Leaflet 适合行政区划和案例点位的交互式地图展示。

#### 核心界面
核心界面包括：
- 登录首页与系统入口页。
- 聊天工作区：侧边栏线程列表、中部聊天区、右侧详情面板。
- 知识图谱页：图谱可视化浏览入口。
- 案例提取页：案例抽取与结果展示入口。
- 聊天消息内富内容：进度条、Markdown、地图、GraphRAG 结果按钮、HITL 卡片。

#### 状态管理与通信
前端状态管理采用“React Context + React Query + 组件局部状态”的组合：
- `AuthContext` 管理当前用户与用户切换。
- `DrawerContext` 管理右侧抽屉内容。
- `AgentContext` 管理当前智能体运行状态。
- React Query 管理线程列表、线程历史分页、地理数据等服务端状态。
- CopilotKit 内部负责当前聊天消息流和智能体交互状态。

通信方式包括：
- 普通数据通过 `fetch` 调用 FastAPI REST API。
- 聊天通过 CopilotKit Runtime 发起协议请求。
- 用户身份通过 `X-User-Id` 头部向后端透传。

---

### 后端设计

#### 技术选型
后端采用以下技术栈：
- FastAPI
- Pydantic
- aiosqlite
- LangGraph AsyncSqliteSaver
- pandas / parquet 读取
- Uvicorn

技术选型特点：
- FastAPI 适合快速定义异步 REST 接口与智能体协议端点。
- SQLite 便于单机部署、开发调试和线程持久化。
- AsyncSqliteSaver 直接支持 LangGraph checkpoint 持久化。

#### API设计
后端主要 API 分组如下：
- 线程管理：线程列表、创建、重命名、删除。
- 历史恢复：bootstrap、client-state、messages 分页、state 查询。
- Agent 状态：保存与获取线程 Agent 状态。
- GraphRAG 可视化：图谱原始数据和图结构数据接口。
- LLM 管理：模型列表、当前模型、切换模型。
- 案例提取：案例抽取请求与提示模板接口。

#### WebSocket设计
当前后端未提供独立 WebSocket 服务。

原因：
- 智能体实时输出和步骤状态已经通过 CopilotKit / AG-UI 协议承担。
- 引入额外 WebSocket 不会显著降低当前实现复杂度，反而会形成双通道状态同步问题。

#### 认证机制
当前实现未采用 JWT，也未引入完整的后端认证中心。

实际机制为：
- 用户在前端本地登录，用户信息保存在浏览器 `localStorage`。
- 前端请求通过 `X-User-Id` 头部透传当前用户标识。
- 后端按线程所属用户进行轻量校验。

该设计适合单机演示、内网测试和原型阶段；若进入正式生产，应升级为服务端会话或 JWT/OAuth 认证体系。

---

### 智能体设计

#### 架构设计
智能体采用 LangGraph 状态图架构，结合工具调用和多步骤状态输出。当前核心实现位于 `agent/test_agent/agent.py`，主要特点包括：
- 以 `TestAgentState` 维护工作流状态。
- 通过 LangGraph 节点划分意图路由、检索、审核、综合等步骤。
- 通过 `copilotkit_emit_state` 向前端输出中间状态。
- 通过 `interrupt` 支持人工审核与确认流程。

#### 工作流程
智能体工作流程可概括为：
1. 接收用户输入与线程上下文。
2. 进行意图路由，识别是一般问答、参数问答、案例分布还是 GraphRAG 检索。
3. 选择并调用相应工具或检索函数。
4. 必要时进入人工审核中断节点。
5. 汇总工具结果，构造最终回答与附加数据标记。
6. 将消息与状态持久化。

#### 工具集设计
当前工具集主要包括：
- GraphRAG Local Search
- GraphRAG Global Search
- 案例分布点位查询工具
- 地理编码与地理特征补充工具
- 案例详情查询工具
- 参数与知识仓库识别相关工具

#### 提示词设计
提示词设计原则包括：
- 明确约束输出语言为中文。
- 根据知识仓库类型与参数体系限制可回答范围。
- 在综合输出阶段附带 AGENT_DATA 与 AGENT_STATE 标记，供前端恢复地图和状态展示。
- 对结构化输出采用 JSON 解析与容错回退机制。

#### 用户身份传递
智能体执行本身主要通过 `thread_id` 隔离上下文；用户身份控制由 FastAPI 接口层实现：
- 前端请求携带 `X-User-Id`。
- 线程访问前在 `thread_routes.py` 中校验当前用户是否拥有该线程。
- 线程不存在但允许 claim 的场景，会在后端初始化线程归属。

---

### 模型计算设计

#### 模型运行架构
模型运行架构为“共享模型配置 + 按会话隔离状态”的形式：
- 当前活动 LLM 模型由配置模块统一管理，可在运行时切换。
- 每次请求通过 LangGraph 工作流执行，不同线程通过 `thread_id` 隔离。
- 流式调用失败时可自动降级为非流式调用。
- 会话图实例由 `SessionGraphManager` 管理，定期清理过期会话，避免内存长期增长。

#### 模拟流程
若以一次典型问答/检索过程为例，模型执行流程如下：
1. 校验用户输入与当前上下文。
2. 根据知识仓库、问题类型和参数信息完成意图路由。
3. 调用对应检索或案例工具。
4. 将检索结果和状态写回 LangGraph state。
5. 生成最终文本结果，并附加前端需要的状态与数据标记。
6. 将用户消息和助手消息成对写入 `thread_messages`。

---

## 总结
当前系统是一个以 GraphRAG 智能问答为中心的单仓分层系统，具有以下设计特点：
- 前端、Runtime、Agent 服务三层职责边界清晰。
- 线程恢复采用 bootstrap + 分页消息的轻量化方案，适合长对话和历史持久化场景。
- 智能体工作流采用 LangGraph 实现，支持流式状态输出和人工审核中断。
- 数据层以 SQLite 为核心，兼顾对话持久化和开发部署复杂度控制。
- 地图、图谱、案例详情、GraphRAG 结果均已纳入统一聊天工作区中。

从现状看，该系统适合演示环境、内网试用和持续迭代阶段。若后续面向正式生产，建议优先补强以下方面：
- 服务端认证与权限体系。
- 更明确的前后端错误恢复与可观测性。
- 长对话渲染窗口与富组件消息渲染策略。
- 数据库备份、迁移与多实例部署方案。
