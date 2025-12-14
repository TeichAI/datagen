import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { countNonEmptyLines, ProgressBar } from "./progress.js";
import { loadConfigRawArgs } from "./config.js";
import {
  calculateOpenRouterSpendUSD,
  getOpenRouterModelPricing,
  isOpenRouterApiBase,
  type OpenRouterModelPricing,
  type OpenRouterUsage
} from "./openrouter.js";
import packageJson from "../package.json" with { type: "json" };
import { maybeNotifyNewVersion } from "./update-check.js";

function trimTrailingZeros(num: string): string {
  if (!num.includes(".")) return num;
  const trimmed = num.replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

function formatUsdRate(raw: string | undefined, fallback: number): string {
  if (typeof raw === "string" && raw.trim().length > 0) return `$${trimTrailingZeros(raw)}`;
  if (!Number.isFinite(fallback)) return "$0";
  const abs = Math.abs(fallback);
  const decimals = abs >= 0.01 ? 6 : 10;
  return `$${trimTrailingZeros(fallback.toFixed(decimals))}`;
}

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  const abs = Math.abs(amount);
  if (abs === 0) return "$0";
  const decimals = abs >= 10 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : abs >= 0.0001 ? 8 : 10;
  const rounded = Number(amount.toFixed(decimals));
  if (rounded === 0) {
    const min = 1 / 10 ** decimals;
    const minLabel = trimTrailingZeros(min.toFixed(decimals));
    return amount < 0 ? `>-$${minLabel}` : `<$${minLabel}`;
  }
  return `$${trimTrailingZeros(amount.toFixed(decimals))}`;
}

function formatUsdPerMillionTokens(
  known: boolean,
  rawPerToken: string | undefined,
  fallbackPerToken: number
): string {
  if (!known) return "unknown/1M tok";
  const perToken =
    typeof rawPerToken === "string" && rawPerToken.trim().length > 0
      ? Number(rawPerToken)
      : fallbackPerToken;
  const perMillion = (Number.isFinite(perToken) ? perToken : 0) * 1_000_000;
  return `${formatUsd(perMillion)}/1M tok`;
}

function formatUsdOrUnknown(
  known: boolean,
  raw: string | undefined,
  fallback: number
): string {
  if (!known) return "unknown";
  return formatUsdRate(raw, fallback);
}

const CLI_NAME = "datagen";
const CLI_PACKAGE_NAME = typeof packageJson.name === "string" ? packageJson.name : CLI_NAME;
const CLI_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

const HELP_TEXT = [
  `${CLI_NAME} ${CLI_VERSION}`,
  "",
  `Usage: ${CLI_NAME} --model <model> --prompts <file> [options]`,
  "",
  "Options:",
  "  --help                          Show this help message and exit.",
  "  --version                       Print the CLI version and exit.",
  "  --config <file>                 Load options from a YAML/JSON config file.",
  "  --model <name>                  Model name to use for completions.",
  "  --prompts <file>                Path to a file where each line is a prompt.",
  "  --out <file>                    Output JSONL file (default: dataset.jsonl).",
  "  --api <baseUrl>                 API base URL (default: https://openrouter.ai/api/v1).",
  "  --system <text>                 Optional system prompt to include.",
  "  --store-system true|false       Whether to emit the system prompt in the dataset (default: true).",
  "  --concurrent <num>              Number of parallel requests (default: 1).",
  "  --openrouter.provider <slugs>   OpenRouter provider slugs (comma-separated list).",
  "  --openrouter.providerSort <x>   Provider sorting order (price|throughput|latency).",
  "  --reasoningEffort <level>       Reasoning effort (none|minimal|low|medium|high|xhigh).",
  "  --no-progress                   Disable the progress bar.",
  "",
  'Environment: Set the API_KEY env var to your OpenRouter API key before running.',
  ""
].join("\n");

const USAGE_LINE = `Usage: ${CLI_NAME} --model <model> --prompts <file> [options]`;

const FLAG_ALIASES: Record<string, string[]> = {
  help: ["--help", "-h"],
  version: ["--version", "-v"]
};

function hasFlag(argv: string[], flags: string[]) {
  return argv.some((token) => flags.includes(token));
}

export function printHelp() {
  console.log(HELP_TEXT);
}

export function printVersion() {
  console.log(`${CLI_NAME} ${CLI_VERSION}`);
}

export type Args = {
  model: string;
  promptsPath: string;
  outPath: string;
  apiBase: string;
  systemPrompt: string;
  storeSystem: boolean;
  progress: boolean;
  concurrent: number;
  openrouterProviderOrder: string[] | null;
  openrouterProviderSort: string | null;
  reasoningEffort: string | null;
};

function parseRawArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eqIdx = token.indexOf("=");
    if (eqIdx !== -1) {
      const key = token.slice(2, eqIdx);
      const value = token.slice(eqIdx + 1);
      if (key.length > 0) args[key] = value;
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function parseArgsFromRaw(args: Record<string, string | boolean>): Args {
  const model = (args.model as string) || "";
  const promptsPath = (args.prompts as string) || "";
  const outPath = (args.out as string) || "dataset.jsonl";
  const apiBase = (args.api as string) || "https://openrouter.ai/api/v1";
  const systemPrompt = (args.system as string) || "";
  const storeSystemRaw = args["store-system"];
  const storeSystem =
    storeSystemRaw === undefined
      ? true
      : String(storeSystemRaw).toLowerCase() !== "false";
  const progressRaw = args.progress;
  let progress =
    progressRaw === undefined
      ? true
      : String(progressRaw).toLowerCase() !== "false";
  if (args["no-progress"] !== undefined) progress = false;

  const concurrentRaw = args.concurrent;
  const concurrentParsed =
    concurrentRaw === undefined ? 1 : Math.floor(Number(concurrentRaw));
  const concurrent =
    Number.isFinite(concurrentParsed) && concurrentParsed > 0
      ? concurrentParsed
      : 1;

  const openrouterProviderRaw = args["openrouter.provider"];
  const openrouterProviderOrder =
    typeof openrouterProviderRaw === "string" && openrouterProviderRaw.trim().length > 0
      ? openrouterProviderRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : null;

  const openrouterProviderSortRaw = args["openrouter.providerSort"];
  const openrouterProviderSort =
    typeof openrouterProviderSortRaw === "string" &&
    openrouterProviderSortRaw.trim().length > 0
      ? openrouterProviderSortRaw.trim()
      : null;

  const reasoningEffortRaw = args.reasoningEffort;
  const reasoningEffort =
    typeof reasoningEffortRaw === "string" && reasoningEffortRaw.trim().length > 0
      ? reasoningEffortRaw.trim()
      : null;

  if (!model || !promptsPath) {
    throw new Error(
      `${USAGE_LINE} [--out dataset.jsonl] [--api https://openrouter.ai/api/v1] [--system "..."] [--store-system true|false] [--concurrent 1] [--openrouter.provider openai,anthropic] [--openrouter.providerSort price|throughput|latency] [--reasoningEffort low|medium|high] [--no-progress]`
    );
  }

  return {
    model,
    promptsPath,
    outPath,
    apiBase,
    systemPrompt,
    storeSystem,
    progress,
    concurrent,
    openrouterProviderOrder,
    openrouterProviderSort,
    reasoningEffort
  };
}

export function parseArgs(argv: string[]): Args {
  const cliRaw = parseRawArgs(argv);
  const configRawValue = cliRaw.config;
  if (configRawValue !== undefined && typeof configRawValue !== "string") {
    throw new Error(`${USAGE_LINE} --config <file>`);
  }
  const configPath =
    typeof configRawValue === "string" && configRawValue.trim().length > 0
      ? resolve(configRawValue)
      : null;

  const merged =
    configPath
      ? { ...loadConfigRawArgs(configPath), ...cliRaw }
      : cliRaw;

  return parseArgsFromRaw(merged);
}

export function buildRequestMessages(
  systemPrompt: string,
  userPrompt: string
) {
  return systemPrompt.trim().length > 0
    ? [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt }
      ]
    : [{ role: "user" as const, content: userPrompt }];
}

export function formatAssistantContent(content: string, reasoning?: string) {
  return typeof reasoning === "string" && reasoning.trim().length > 0
    ? `<think>${reasoning}</think>\n${content}`
    : content;
}

export function buildOutputMessages(
  systemPrompt: string,
  userPrompt: string,
  assistantContent: string,
  storeSystem: boolean
) {
  const hasSystem = systemPrompt.trim().length > 0;
  if (hasSystem && storeSystem) {
    return [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
      { role: "assistant" as const, content: assistantContent }
    ];
  }
  return [
    { role: "user" as const, content: userPrompt },
    { role: "assistant" as const, content: assistantContent }
  ];
}

export async function callOpenRouter(
  apiBase: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  provider?: { order?: string[]; sort?: string },
  reasoningEffort?: string | null
): Promise<{ content: string; reasoning?: string; usage?: OpenRouterUsage }> {
  const url = `${apiBase.replace(/\/$/, "")}/chat/completions`;
  const messages = buildRequestMessages(systemPrompt, userPrompt);

  const providerPref =
    provider && (Array.isArray(provider.order) || typeof provider.sort === "string")
      ? provider
      : undefined;
  const reasoningEffortPref =
    typeof reasoningEffort === "string" && reasoningEffort.trim().length > 0
      ? reasoningEffort.trim()
      : undefined;
  const reasoningPref =
    reasoningEffortPref ? { effort: reasoningEffortPref } : undefined;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
      // IMPORTANT: no OpenRouter application headers (HTTP-Referer / X-Title)
    },
    body: JSON.stringify({
      model,
      messages,
      ...(reasoningPref ? { reasoning: reasoningPref } : {}),
      ...(providerPref ? { provider: providerPref } : {})
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  const choice = data?.choices?.[0];
  const message = choice?.message ?? choice?.delta ?? {};
  const content = message?.content ?? "";
  const reasoning =
    message?.reasoning ??
    choice?.reasoning ??
    data?.reasoning ??
    undefined;
  const usage = data?.usage as OpenRouterUsage | undefined;

  if (typeof content !== "string" || !content.length) {
    throw new Error("No assistant content returned from OpenRouter.");
  }

  return { content, reasoning, usage };
}

export async function ensureReadableFile(filePath: string) {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    throw err;
  }

  if (!st.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  await fs.access(filePath);
}

export async function main(argv = process.argv.slice(2)) {
  await maybeNotifyNewVersion({
    cliName: CLI_NAME,
    packageName: CLI_PACKAGE_NAME,
    currentVersion: CLI_VERSION
  });

  if (hasFlag(argv, FLAG_ALIASES.help)) {
    printHelp();
    return;
  }

  if (hasFlag(argv, FLAG_ALIASES.version)) {
    printVersion();
    return;
  }

  let parsed: Args;
  try {
    parsed = parseArgs(argv);
  } catch (err: any) {
    console.error(err?.message ?? String(err));
    process.exit(1);
    return;
  }

  const {
    model,
    promptsPath,
    outPath,
    apiBase,
    systemPrompt,
    storeSystem,
    progress,
    concurrent,
    openrouterProviderOrder,
    openrouterProviderSort,
    reasoningEffort
  } = parsed;

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error('Missing env var "API_KEY".');
    process.exit(1);
  }

  const absPromptsPath = resolve(promptsPath);
  const absOutPath = resolve(outPath);

  try {
    await ensureReadableFile(absPromptsPath);
  } catch (err: any) {
    console.error(err?.message ?? String(err));
    process.exit(1);
    return;
  }

  const useProgress = progress && Boolean(process.stderr.isTTY);
  let totalPrompts = 0;
  if (useProgress) {
    try {
      totalPrompts = await countNonEmptyLines(absPromptsPath);
    } catch {
      totalPrompts = 0;
    }
  }
  const bar =
    useProgress && totalPrompts > 0 ? new ProgressBar(totalPrompts, process.stderr) : null;

  const isOpenRouter = isOpenRouterApiBase(apiBase);
  const providerPref =
    isOpenRouter && (openrouterProviderOrder || openrouterProviderSort)
      ? {
          ...(openrouterProviderOrder ? { order: openrouterProviderOrder } : {}),
          ...(openrouterProviderSort ? { sort: openrouterProviderSort } : {})
        }
      : undefined;
  let pricing: OpenRouterModelPricing | null = null;
  if (isOpenRouter) {
    try {
      pricing = await getOpenRouterModelPricing(apiBase, apiKey, model);
      if (!pricing) {
        const msg = `WARN: Could not find pricing for model "${model}" on OpenRouter.`;
        if (bar) bar.writeLine(msg);
        else process.stderr.write(msg + "\n");
      }
    } catch (err: any) {
      const msg = `WARN: Failed to fetch OpenRouter models/pricing: ${err?.message ?? String(err)}`;
      if (bar) bar.writeLine(msg);
      else process.stderr.write(msg + "\n");
    }
  }

  if (pricing) {
    const lines = [
      `Model: ${model}`,
      `API: ${apiBase}`,
      pricing.modelId !== model
        ? `OpenRouter pricing model: ${pricing.modelId}`
        : null,
      providerPref
        ? `OpenRouter provider prefs: ${JSON.stringify(providerPref)}`
        : null,
      reasoningEffort ? `Reasoning effort: ${reasoningEffort}` : null,
      `Pricing (USD per 1M tokens): prompt=${formatUsdPerMillionTokens(pricing.known.prompt, pricing.raw.prompt, pricing.promptPerTokenUSD)} completion=${formatUsdPerMillionTokens(pricing.known.completion, pricing.raw.completion, pricing.completionPerTokenUSD)}`,
      `Pricing (USD per token): prompt=${formatUsdOrUnknown(pricing.known.prompt, pricing.raw.prompt, pricing.promptPerTokenUSD)}/token completion=${formatUsdOrUnknown(pricing.known.completion, pricing.raw.completion, pricing.completionPerTokenUSD)}/token`,
      `Pricing (USD per request): request=${formatUsdOrUnknown(pricing.known.request, pricing.raw.request, pricing.requestUSD)}/request`
    ].filter((l): l is string => Boolean(l));
    for (const l of lines) {
      if (bar) bar.writeLine(l);
      else process.stderr.write(l + "\n");
    }

    if (!pricing.known.prompt || !pricing.known.completion) {
      const msg = "WARN: OpenRouter did not provide token pricing for this model; spent total will be omitted.";
      if (bar) bar.writeLine(msg);
      else process.stderr.write(msg + "\n");
    }
  }

  const rl = createInterface({
    input: createReadStream(absPromptsPath),
    crlfDelay: Infinity
  });

  const out = createWriteStream(absOutPath, { flags: "w" });

  let lineNum = 0;
  let completed = 0;
  let okCount = 0;
  let errCount = 0;
  let spentUsd = 0;
  const canTrackSpend = Boolean(
    pricing && pricing.known.prompt && pricing.known.completion && pricing.known.request
  );
  if (bar)
    bar.render(0, {
      ok: 0,
      err: 0,
      spentUsd: canTrackSpend ? spentUsd : undefined
    });

  const inFlight = new Set<Promise<void>>();
  const maxConcurrent = Math.max(1, concurrent);

  let writeQueue = Promise.resolve();
  const writeJsonlLine = (line: string) => {
    writeQueue = writeQueue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          out.write(line, (err) => {
            if (err) reject(err);
            else resolve();
          });
        })
    );
    return writeQueue;
  };

  const renderProgress = () => {
    if (!bar) return;
    bar.render(completed, {
      ok: okCount,
      err: errCount,
      spentUsd: canTrackSpend ? spentUsd : undefined
    });
  };

  const schedule = (index: number, line: number, prompt: string) => {
    const p = (async () => {
      try {
        const { content, reasoning, usage } = await callOpenRouter(
          apiBase,
          apiKey,
          model,
          systemPrompt,
          prompt,
          providerPref,
          reasoningEffort
        );

        if (canTrackSpend && pricing) {
          spentUsd += calculateOpenRouterSpendUSD(pricing, usage);
        }

        const assistantContent = formatAssistantContent(content, reasoning);
        const messages = buildOutputMessages(
          systemPrompt,
          prompt,
          assistantContent,
          storeSystem
        );

        await writeJsonlLine(JSON.stringify({ messages }) + "\n");
        okCount++;
      } catch (err: any) {
        const msg = `ERR line ${line}: ${err?.message ?? String(err)}`;
        if (bar) bar.writeLine(msg);
        else process.stderr.write(msg + "\n");
        errCount++;
      } finally {
        completed++;
        renderProgress();
      }
    })();

    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  };

  const waitForSlot = async () => {
    while (inFlight.size >= maxConcurrent) {
      await Promise.race(inFlight);
    }
  };

  let promptIndex = 0;
  for await (const line of rl) {
    lineNum++;
    const prompt = line.trim();
    if (!prompt) continue;

    await waitForSlot();
    schedule(promptIndex, lineNum, prompt);
    promptIndex++;
  }

  while (inFlight.size > 0) {
    await Promise.race(inFlight);
  }

  out.end();
  if (bar) {
    bar.finish(completed, {
      ok: okCount,
      err: errCount,
      spentUsd: canTrackSpend ? spentUsd : undefined
    });
  }
}
