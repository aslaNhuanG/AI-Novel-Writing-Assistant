/**
 * Verifies the patched connectivity probe against the live local provider config.
 * Prints the probe outcome the UI would render; never prints the API key.
 */
const { llmConnectivityService } = require("../dist/llm/connectivity.js");
const { secretStore } = require("../dist/services/settings/secretStore/index.js");

function formatStatus(status) {
  const plain = status.plain;
  const structured = status.structured;
  const protocolLabel = (v) => (v === "openai_compatible" ? "OpenAI 兼容" : v === "anthropic" ? "Anthropic" : v ?? "");
  const plainText = plain
    ? plain.ok
      ? `普通连通正常${plain.latency != null ? ` (${plain.latency}ms)` : ""}${plain.requestProtocol ? `，协议 ${protocolLabel(plain.requestProtocol)}` : ""}`
      : `普通连通失败${plain.requestProtocol ? `（${protocolLabel(plain.requestProtocol)}）` : ""}${plain.error ? `：${plain.error}` : ""}`
    : "普通连通未检测";
  const structuredText = structured
    ? structured.ok
      ? `结构化正常${structured.strategy ? `，策略 ${structured.strategy}` : ""}${structured.reasoningForcedOff ? "，已强制关闭 thinking" : ""}`
      : `结构化失败${structured.errorCategory ? `，分类 ${structured.errorCategory}` : ""}${structured.error ? `：${structured.error}` : ""}`
    : "结构化未检测";
  return `连接成功，总耗时 ${status.latency ?? 0}ms · ${plainText} · ${structuredText}`;
}

(async () => {
  const provider = process.argv[2] || "glm";
  const model = process.argv[3] || "glm-4.7-flash";
  const secret = await secretStore.getProvider(provider);
  if (!secret) throw new Error(`provider ${provider} not configured`);

  const status = await llmConnectivityService.testConnection({
    provider,
    model,
    apiKey: secret.key,
    baseURL: secret.baseURL ?? undefined,
    authMode: secret.authMode ?? undefined,
    probeMode: "both",
  });
  console.log(`\n--- provider=${provider} model=${model} base=${secret.baseURL} ---`);
  console.log(formatStatus(status));
  console.log("\nraw plain:", JSON.stringify(status.plain, null, 2));
})();
