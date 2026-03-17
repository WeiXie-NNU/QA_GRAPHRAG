import express from 'express';
import 'dotenv/config';
import {
  CopilotRuntime,
  copilotRuntimeNodeHttpEndpoint,
  OpenAIAdapter,
} from '@copilotkit/runtime';
import { LangGraphHttpAgent } from '@copilotkit/runtime/langgraph';
import OpenAI from "openai";
import cors from 'cors';

const app = express();
// 增加请求体大小限制，因为长对话累积占用存储
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS 配置（支持局域网跨域访问 + CopilotKit 自定义头部）
app.use(cors({
  origin: (origin, callback) => {
    // 允许所有来源
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  // 不指定 allowedHeaders，让中间件自动反射请求的 Access-Control-Request-Headers
}));

// ------------------------------------------------------------
// Runtime stability guard:
// Node 24 + undici 在对端提前关闭流时可能抛出未捕获的 `TypeError: terminated`
// 为避免 runtime 进程直接退出，这里统一兜底并降级为日志。
// ------------------------------------------------------------
function isUndiciTerminatedError(err: any): boolean {
  if (!err) return false;
  const message = String(err?.message || "");
  const causeCode = String(err?.cause?.code || "");
  return message.includes("terminated") || causeCode === "UND_ERR_SOCKET";
}

process.on("unhandledRejection", (reason) => {
  if (isUndiciTerminatedError(reason)) {
    console.warn("[Runtime] Ignored transient undici termination:", reason);
    return;
  }
  console.error("[Runtime] Unhandled rejection:", reason);
});

process.on("uncaughtException", (err) => {
  if (isUndiciTerminatedError(err)) {
    console.warn("[Runtime] Ignored transient undici termination:", err);
    return;
  }
  console.error("[Runtime] Uncaught exception:", err);
});

// LLM 模型配置
let currentLLMModel = process.env.LLM_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY,  baseURL: process.env.OPENAI_API_BASE});

// 动态创建 serviceAdapter
let serviceAdapter = new OpenAIAdapter({ openai, model: currentLLMModel } as any);

// 支持的 LLM 模型列表
const SUPPORTED_LLM_MODELS = [
  { value: "gpt-4o", label: "GPT-4o (最强)" },
  { value: "gpt-4o-mini", label: "GPT-4o-mini (推荐)" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo (快速)" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
];

// Python Agent 服务器的基础 URL（可通过环境变量覆盖）
function normalizeBaseUrl(raw: string | undefined, fallback: string): string {
  const value = String(raw ?? fallback)
    .replace(/\s+/g, "")
    .replace(/\/+$/, "");
  try {
    // 仅用于校验，抛错时回退到 fallback
    // eslint-disable-next-line no-new
    new URL(value);
    return value;
  } catch {
    const fb = fallback.replace(/\s+/g, "").replace(/\/+$/, "");
    return fb;
  }
}

function joinUrl(base: string, path: string): string {
  const cleanBase = String(base || "").replace(/\s+/g, "").replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/\s+/g, "").replace(/^\/+/, "");
  return `${cleanBase}/${cleanPath}`;
}

const AGENT_BASE_URL = normalizeBaseUrl(process.env.AGENT_BASE_URL, "http://127.0.0.1:8090");
const TEST_AGENT_URL = joinUrl(AGENT_BASE_URL, "/copilotkit/agents/test");
const COPILOTKIT_RUNTIME_VERSION = "1.53.0";

// 创建 agent 工厂函数 - 每个请求创建新的 agent 实例以支持并发
// 这确保每个请求都有独立的状态追踪
const createTestAgent = () => new LangGraphHttpAgent({
    url: TEST_AGENT_URL,
});


console.log('=== CopilotKit Runtime Agents Configuration ===');
console.log('test agent URL:', TEST_AGENT_URL);

// CopilotKit Runtime 配置
// 使用 agents + LangGraphHttpAgent 连接到本地 FastAPI AG-UI 端点
// 每个 agent 都有独立的端点路径
const runtime = new CopilotRuntime({
    agents: {
        // 使用工厂函数而不是单例，以支持并发请求
        'test': createTestAgent() as any,
    } as any,
});

console.log('CopilotRuntime created with agents:', Object.keys((runtime as any).agents || {}));

// 为 CopilotKit 端点单独设置更大的请求体限制
// express.json() 中间件必须在 handler 之前应用
app.use('/copilotkit', express.json({ limit: '50mb' }));

function isLoadAgentStateRequest(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  if (body.operationName === "loadAgentState") return true;
  const queryText = String(body.query || "");
  return queryText.includes("loadAgentState");
}

app.use('/copilotkit', async (req, res, next) => {
  if (req.method !== "POST" || !isLoadAgentStateRequest(req.body)) {
    return next();
  }

  const threadId = String(req.body?.variables?.data?.threadId || "").trim();
  const agentName = String(req.body?.variables?.data?.agentName || "test").trim() || "test";
  if (!threadId) {
    return next();
  }

  try {
    const clientStateUrl = joinUrl(
      AGENT_BASE_URL,
      `/threads/${encodeURIComponent(threadId)}/client-state?agent=${encodeURIComponent(agentName)}`,
    );
    const response = await fetch(clientStateUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return next();
    }

    const payload = await response.json() as {
      thread_exists?: boolean;
      agentState?: Record<string, unknown> | null;
    };

    res.setHeader("X-CopilotKit-Runtime-Version", COPILOTKIT_RUNTIME_VERSION);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({
      data: {
        loadAgentState: {
          threadId,
          threadExists: Boolean(payload?.thread_exists),
          state: JSON.stringify(payload?.agentState || {}),
          messages: "[]",
        },
      },
    });
  } catch (error) {
    console.warn("[Runtime] loadAgentState lightweight fallback failed:", error);
    return next();
  }
});

// CopilotKit 端点处理
const handler = copilotRuntimeNodeHttpEndpoint({
  endpoint: '/copilotkit',
  runtime,
  serviceAdapter,
});

// 注意：endpoint 已经是 /copilotkit，不能再在 express 层重复挂载 /copilotkit
// 否则新版本路由会变成双前缀导致 runtime info 404。
app.use(handler as any);

// LLM 模型管理 API
app.get('/api/llm/models', (req, res) => {
  res.json({
    models: SUPPORTED_LLM_MODELS,
    current: currentLLMModel
  });
});

app.get('/api/llm/current', (req, res) => {
  res.json({ model: currentLLMModel });
});

app.post('/api/llm/set-model', (req, res) => {
  const { model } = req.body;
  if (!model) {
    return res.status(400).json({ success: false, message: 'Model is required' });
  }
  
  currentLLMModel = model;
  // 重新创建 serviceAdapter
  serviceAdapter = new OpenAIAdapter({ openai, model: currentLLMModel } as any);
  
  console.log(`[Runtime] LLM 模型已切换到: ${model}`);
  
  res.json({
    success: true,
    model: currentLLMModel,
    message: `LLM 模型已切换到: ${model}`
  });
});

// 知识图谱 API
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// ES 模块中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/api/knowledge-graph', async (req, res) => {
  try {
    const pythonScript = path.join(__dirname, '../agent/test_agent/graph_api.py');
    const python = spawn('python', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(pythonScript).replace(/\\/g, '\\\\')}')
from graph_api import get_graph_data
import json
print(json.dumps(get_graph_data(), ensure_ascii=False))
`]);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[KG API] Python error:', errorOutput);
        return res.status(500).json({ 
          error: 'Failed to load knowledge graph',
          details: errorOutput 
        });
      }

      try {
        const graphData = JSON.parse(output);
        res.json(graphData);
      } catch (parseError) {
        console.error('[KG API] JSON parse error:', parseError);
        res.status(500).json({ 
          error: 'Failed to parse graph data',
          details: String(parseError)
        });
      }
    });
  } catch (error) {
    console.error('[KG API] Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: String(error)
    });
  }
});

app.get('/api/knowledge-graph/stats', async (req, res) => {
  try {
    const pythonScript = path.join(__dirname, '../agent/test_agent/graph_api.py');
    const python = spawn('python', ['-c', `
import sys
sys.path.insert(0, '${path.dirname(pythonScript).replace(/\\/g, '\\\\')}')
from graph_api import get_graph_stats
import json
print(json.dumps(get_graph_stats(), ensure_ascii=False))
`]);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[KG Stats API] Python error:', errorOutput);
        return res.status(500).json({ 
          error: 'Failed to get graph stats',
          details: errorOutput 
        });
      }

      try {
        const stats = JSON.parse(output);
        res.json(stats);
      } catch (parseError) {
        console.error('[KG Stats API] JSON parse error:', parseError);
        res.status(500).json({ 
          error: 'Failed to parse stats data',
          details: String(parseError)
        });
      }
    });
  } catch (error) {
    console.error('[KG Stats API] Error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: String(error)
    });
  }
});

app.listen(4000, '0.0.0.0', () => {
  console.log('Listening at http://0.0.0.0:4000/copilotkit');
  console.log('Local access: http://127.0.0.1:4000/copilotkit');
  console.log(`Current LLM model: ${currentLLMModel}`);
  console.log('Knowledge Graph API available at http://0.0.0.0:4000/api/knowledge-graph');
});
