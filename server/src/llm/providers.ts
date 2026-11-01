import {
  LLM_PROVIDERS,
  isBuiltinLLMProvider,
  type BuiltinLLMProvider,
  type LLMProvider,
} from "@ai-novel/shared/types/llm";

/**
 * 厂商模型名别名归一。DeepSeek 官方接口当前只接受 `deepseek-flash` 与 `deepseek-v4-pro`，
 * 传入旧名会直接 400：
 *   The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-pro.
 * 这里把历史别名映射到当前受支持名，避免旧的下拉选择 / 本地缓存 / env 配置直接打到接口报错。
 * 注意：只映射已知失效的旧名，合法模型名原样返回（对内核模型策略的快照校验为零影响）。
 */
const PROVIDER_MODEL_ALIASES: Partial<Record<BuiltinLLMProvider, Record<string, string>>> = {
  deepseek: {
    "deepseek-pro": "deepseek-v4-pro",
    "deepseek-v4-flash": "deepseek-flash",
    "deepseek-chat": "deepseek-flash",
  },
};

export function normalizeProviderModelName(
  provider: LLMProvider,
  model: string | undefined,
): string | undefined {
  const name = model?.trim();
  if (!name) return model;
  const aliases = PROVIDER_MODEL_ALIASES[provider as BuiltinLLMProvider];
  return aliases?.[name] ?? model;
}

export interface ProviderConfig {
  name: string;
  baseURL: string;
  defaultModel: string;
  models: string[];
  envKey: string;
  envBaseURLKey?: string;
  envModelKey?: string;
  maxTokens?: number;
  requiresApiKey?: boolean;
}

export const PROVIDERS: Record<BuiltinLLMProvider, ProviderConfig> = {
  deepseek: {
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-flash",
    // 官方接口当前仅支持这两个模型名；旧名 deepseek-pro / deepseek-v4-flash 会被 400，
    // 因此不再列入预设（避免「刷新模型」时被并集重新加回下拉列表）。
    models: ["deepseek-flash", "deepseek-v4-pro"],
    envKey: "DEEPSEEK_API_KEY",
    envBaseURLKey: "DEEPSEEK_BASE_URL",
    envModelKey: "DEEPSEEK_MODEL",
    maxTokens: 8192,
  },
  siliconflow: {
    name: "SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    models: [
      "Qwen/Qwen2.5-7B-Instruct",
      "Qwen/Qwen2.5-72B-Instruct",
      "deepseek-ai/DeepSeek-V3",
    ],
    envKey: "SILICONFLOW_API_KEY",
    envBaseURLKey: "SILICONFLOW_BASE_URL",
    envModelKey: "SILICONFLOW_MODEL",
  },
  openai: {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    models: ["gpt-5", "gpt-5-mini"],
    envKey: "OPENAI_API_KEY",
    envBaseURLKey: "OPENAI_BASE_URL",
    envModelKey: "OPENAI_MODEL",
  },
  anthropic: {
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-20241022",
    models: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ],
    envKey: "ANTHROPIC_API_KEY",
    envBaseURLKey: "ANTHROPIC_BASE_URL",
    envModelKey: "ANTHROPIC_MODEL",
  },
  grok: {
    name: "Grok",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-4",
    models: [
      "grok-4",
      "grok-4-latest",
      "grok-4-1-fast-reasoning",
      "grok-3",
      "grok-code-fast-1",
    ],
    envKey: "XAI_API_KEY",
    envBaseURLKey: "XAI_BASE_URL",
    envModelKey: "XAI_MODEL",
  },
  kimi: {
    name: "Kimi",
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-32k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],
    envKey: "KIMI_API_KEY",
    envBaseURLKey: "KIMI_BASE_URL",
    envModelKey: "KIMI_MODEL",
  },
  minimax: {
    name: "MiniMax",
    baseURL: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M2.7",
    models: [
      "MiniMax-M2.7",
      "MiniMax-M2.7-highspeed",
      "MiniMax-M2.5",
      "MiniMax-M2.5-highspeed",
      "MiniMax-M2.1",
      "MiniMax-M2.1-highspeed",
      "MiniMax-M2",
    ],
    envKey: "MINIMAX_API_KEY",
    envBaseURLKey: "MINIMAX_BASE_URL",
    envModelKey: "MINIMAX_MODEL",
  },
  glm: {
    name: "GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.5-air",
    models: [
      "glm-5.3",
      "glm-5.3-flash",
      "glm-5.2",
      "glm-5.1",
      "glm-5",
      "glm-5-turbo",
      "glm-4.7",
      "glm-4.7-flash",
      "glm-4.7-flashx",
      "glm-4.6",
      "glm-4.5-air",
      "glm-4.5",
      "glm-4.5-flash",
      "glm-4-flash-250414",
    ],
    envKey: "GLM_API_KEY",
    envBaseURLKey: "GLM_BASE_URL",
    envModelKey: "GLM_MODEL",
  },
  qwen: {
    name: "Qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen3.5-plus", "qwen3-max"],
    envKey: "QWEN_API_KEY",
    envBaseURLKey: "QWEN_BASE_URL",
    envModelKey: "QWEN_MODEL",
  },
  gemini: {
    name: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"],
    envKey: "GEMINI_API_KEY",
    envBaseURLKey: "GEMINI_BASE_URL",
    envModelKey: "GEMINI_MODEL",
  },
  ollama: {
    name: "Ollama",
    baseURL: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.2",
    models: ["llama3.2", "qwen3:8b", "deepseek-r1:8b", "gpt-oss:20b"],
    envKey: "OLLAMA_API_KEY",
    envBaseURLKey: "OLLAMA_BASE_URL",
    envModelKey: "OLLAMA_MODEL",
    requiresApiKey: false,
  },
};

export const SUPPORTED_PROVIDERS: BuiltinLLMProvider[] = [...LLM_PROVIDERS];

export function isBuiltInProvider(provider: string): provider is BuiltinLLMProvider {
  return isBuiltinLLMProvider(provider);
}

export function normalizeBaseURL(baseURL: string): string {
  return baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
}

export function getProviderEnvApiKey(provider: LLMProvider): string | undefined {
  if (!isBuiltInProvider(provider)) {
    return undefined;
  }
  const envKey = PROVIDERS[provider].envKey;
  const value = process.env[envKey];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getProviderEnvBaseUrl(provider: LLMProvider): string | undefined {
  if (!isBuiltInProvider(provider)) {
    return undefined;
  }
  const envKey = PROVIDERS[provider].envBaseURLKey;
  if (!envKey) {
    return undefined;
  }
  const value = process.env[envKey];
  return typeof value === "string" && value.trim() ? normalizeBaseURL(value.trim()) : undefined;
}

export function getProviderEnvModel(provider: LLMProvider): string | undefined {
  if (!isBuiltInProvider(provider)) {
    return undefined;
  }
  const envKey = PROVIDERS[provider].envModelKey;
  if (!envKey) {
    return undefined;
  }
  const value = process.env[envKey];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getProviderDefaultBaseUrl(provider: LLMProvider): string | undefined {
  if (!isBuiltInProvider(provider)) {
    return undefined;
  }
  return normalizeBaseURL(PROVIDERS[provider].baseURL);
}

export function resolveProviderBaseUrl(
  provider: LLMProvider,
  customBaseURL?: string,
  fallbackBaseURL?: string,
): string | undefined {
  const normalizedCustom = typeof customBaseURL === "string" && customBaseURL.trim()
    ? normalizeBaseURL(customBaseURL.trim())
    : undefined;
  if (normalizedCustom) {
    return normalizedCustom;
  }
  if (isBuiltInProvider(provider)) {
    return getProviderEnvBaseUrl(provider) ?? getProviderDefaultBaseUrl(provider);
  }
  if (typeof fallbackBaseURL === "string" && fallbackBaseURL.trim()) {
    return normalizeBaseURL(fallbackBaseURL.trim());
  }
  return undefined;
}

export function providerRequiresApiKey(provider: LLMProvider): boolean {
  if (!isBuiltInProvider(provider)) {
    return false;
  }
  return PROVIDERS[provider].requiresApiKey !== false;
}
