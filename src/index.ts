import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { countNonEmptyLines, ProgressBar } from "./progress.js";

export type Args = {
  model: string;
  promptsPath: string;
  outPath: string;
  apiBase: string;
  systemPrompt: string;
  storeSystem: boolean;
  progress: boolean;
};

export function parseArgs(argv: string[]): Args {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }

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

  if (!model || !promptsPath) {
    throw new Error(
      "Usage: datagen --model <modelname> --prompts <file.txt> [--out dataset.jsonl] [--api https://openrouter.ai/api/v1] [--system \"...\"] [--store-system true|false] [--no-progress]"
    );
  }

  return {
    model,
    promptsPath,
    outPath,
    apiBase,
    systemPrompt,
    storeSystem,
    progress
  };
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
  userPrompt: string
): Promise<{ content: string; reasoning?: string }> {
  const url = `${apiBase.replace(/\/$/, "")}/chat/completions`;
  const messages = buildRequestMessages(systemPrompt, userPrompt);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
      // IMPORTANT: no OpenRouter application headers (HTTP-Referer / X-Title)
    },
    body: JSON.stringify({
      model,
      messages
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

  if (typeof content !== "string" || !content.length) {
    throw new Error("No assistant content returned from OpenRouter.");
  }

  return { content, reasoning };
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
    progress
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

  const rl = createInterface({
    input: createReadStream(absPromptsPath),
    crlfDelay: Infinity
  });

  const out = createWriteStream(absOutPath, { flags: "w" });

  let lineNum = 0;
  let processed = 0;
  let okCount = 0;
  let errCount = 0;
  if (bar) bar.render(0, { ok: 0, err: 0 });

  for await (const line of rl) {
    lineNum++;
    const prompt = line.trim();
    if (!prompt) continue;

    try {
      const { content, reasoning } = await callOpenRouter(
        apiBase,
        apiKey,
        model,
        systemPrompt,
        prompt
      );

      const assistantContent = formatAssistantContent(content, reasoning);
      const messages = buildOutputMessages(
        systemPrompt,
        prompt,
        assistantContent,
        storeSystem
      );

      const record = { messages };

      out.write(JSON.stringify(record) + "\n");
      okCount++;
      if (!bar) process.stderr.write(`OK line ${lineNum}\n`);
    } catch (err: any) {
      errCount++;
      const msg = `ERR line ${lineNum}: ${err?.message ?? String(err)}`;
      if (bar) bar.writeLine(msg);
      else process.stderr.write(msg + "\n");
    } finally {
      processed++;
      if (bar) bar.render(processed, { ok: okCount, err: errCount });
    }
  }

  out.end();
  if (bar) bar.finish(processed, { ok: okCount, err: errCount });
}
