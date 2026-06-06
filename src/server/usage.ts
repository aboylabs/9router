type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export function usageFromResponse(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const usage = (body as { usage?: Usage }).usage;
  if (!usage) return null;

  return {
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
    estimated: false
  };
}

export function estimateUsage(requestBody: unknown, responseBody: unknown) {
  const requestText = JSON.stringify(requestBody ?? "");
  const responseText = JSON.stringify(responseBody ?? "");
  const promptTokens = estimateTokens(requestText);
  const completionTokens = estimateTokens(responseText);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true
  };
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function costEstimate(params: {
  promptTokens: number;
  completionTokens: number;
  inputCostPerMillion?: string | number | null;
  outputCostPerMillion?: string | number | null;
}) {
  const input = Number(params.inputCostPerMillion ?? 0);
  const output = Number(params.outputCostPerMillion ?? 0);
  const cost = (params.promptTokens / 1_000_000) * input + (params.completionTokens / 1_000_000) * output;
  return Number.isFinite(cost) ? cost : 0;
}
