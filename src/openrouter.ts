export type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type OpenRouterModelPricing = {
  promptPerTokenUSD: number;
  completionPerTokenUSD: number;
  requestUSD: number;
  modelId: string;
  canonicalSlug?: string;
  known: {
    prompt: boolean;
    completion: boolean;
    request: boolean;
  };
  raw: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
};

type OpenRouterModel = {
  id: string;
  canonical_slug?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
};

function safeParseNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : 0;
}

function isFiniteNumberString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Number(value))
  );
}

export function isOpenRouterApiBase(apiBase: string): boolean {
  try {
    const url = new URL(apiBase);
    return url.host === "openrouter.ai" || url.host.endsWith(".openrouter.ai");
  } catch {
    return apiBase.includes("openrouter.ai");
  }
}

export async function createOpenRouterApiKey(
  apiBase: string,
  managementKey: string,
  name: string
): Promise<string> {
  const url = `${apiBase.replace(/\/$/, "")}/keys`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${managementKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter key create error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  const key = data?.data?.key ?? data?.key ?? data?.value?.key ?? data?.data?.value?.key;
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new Error("OpenRouter key create response missing key.");
  }
  return key;
}

const modelsCache = new Map<string, Promise<OpenRouterModel[]>>();

async function fetchOpenRouterModels(
  apiBase: string,
  apiKey: string
): Promise<OpenRouterModel[]> {
  const key = apiBase.replace(/\/$/, "");
  const cached = modelsCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const url = `${key}/models`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter models error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as any;
    const models = Array.isArray(data?.data) ? data.data : [];
    return models as OpenRouterModel[];
  })();

  modelsCache.set(key, promise);
  return promise;
}

export async function getOpenRouterModelPricing(
  apiBase: string,
  apiKey: string,
  modelIdOrSlug: string
): Promise<OpenRouterModelPricing | null> {
  const models = await fetchOpenRouterModels(apiBase, apiKey);
  const exact = models.find((x) => x?.id === modelIdOrSlug);
  const slugMatches = exact
    ? []
    : models.filter((x) => x?.canonical_slug === modelIdOrSlug);
  const m =
    exact ??
    slugMatches.find((x) => x?.id === x?.canonical_slug) ??
    slugMatches[0];
  if (!m?.pricing) return null;

  const raw = {
    prompt: m.pricing.prompt,
    completion: m.pricing.completion,
    request: m.pricing.request
  };

  return {
    promptPerTokenUSD: safeParseNumber(raw.prompt),
    completionPerTokenUSD: safeParseNumber(raw.completion),
    requestUSD: safeParseNumber(raw.request),
    modelId: m.id,
    canonicalSlug: m.canonical_slug,
    known: {
      prompt: isFiniteNumberString(raw.prompt),
      completion: isFiniteNumberString(raw.completion),
      request: isFiniteNumberString(raw.request)
    },
    raw
  };
}

export function calculateOpenRouterSpendUSD(
  pricing: OpenRouterModelPricing,
  usage: OpenRouterUsage | undefined
): number {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  return (
    pricing.requestUSD +
    promptTokens * pricing.promptPerTokenUSD +
    completionTokens * pricing.completionPerTokenUSD
  );
}
