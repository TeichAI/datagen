import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  buildRequestMessages,
  buildOutputMessages,
  formatAssistantContent,
  callOpenRouter,
  ensureReadableFile
} from "../src/index.js";

test("parseArgs requires model and prompts", () => {
  assert.throws(() => parseArgs([]), /Usage:/);
  assert.throws(() => parseArgs(["--model", "x"]), /Usage:/);
  assert.throws(() => parseArgs(["--prompts", "p.txt"]), /Usage:/);
});

test("parseArgs defaults store-system to true", () => {
  const args = parseArgs(["--model", "m", "--prompts", "p.txt"]);
  assert.equal(args.storeSystem, true);
});

test("parseArgs defaults concurrent to 1", () => {
  const args = parseArgs(["--model", "m", "--prompts", "p.txt"]);
  assert.equal(args.concurrent, 1);
});

test("parseArgs parses --concurrent", () => {
  const args = parseArgs(["--model", "m", "--prompts", "p.txt", "--concurrent", "3"]);
  assert.equal(args.concurrent, 3);
});

test("parseArgs parses OpenRouter provider flags", () => {
  const args = parseArgs([
    "--model",
    "m",
    "--prompts",
    "p.txt",
    "--openrouter.provider",
    "openai, anthropic",
    "--openrouter.providerSort",
    "throughput"
  ]);
  assert.deepEqual(args.openrouterProviderOrder, ["openai", "anthropic"]);
  assert.equal(args.openrouterProviderSort, "throughput");
});

test("parseArgs parses --reasoningEffort", () => {
  const args = parseArgs([
    "--model",
    "m",
    "--prompts",
    "p.txt",
    "--reasoningEffort",
    "high"
  ]);
  assert.equal(args.reasoningEffort, "high");
});

test("parseArgs parses --openrouter.isFree", () => {
  const args = parseArgs([
    "--model",
    "m",
    "--prompts",
    "p.txt",
    "--openrouter.isFree",
    "true"
  ]);
  assert.equal(args.openrouterIsFree, true);
});

test("parseArgs supports --config YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "datagen-"));
  const configPath = join(dir, "config.yaml");
  await writeFile(
    configPath,
    [
      "model: m",
      "prompts: p.txt",
      "out: o.jsonl",
      "api: https://openrouter.ai/api/v1",
      "system: |",
      "  line1",
      "  line2",
      "store-system: false",
      "concurrent: 3",
      "openrouter:",
      "  isFree: true",
      "  provider:",
      "    - openai",
      "    - anthropic",
      "  providerSort: throughput",
      "reasoningEffort: high",
      "no-progress: true",
      ""
    ].join("\n")
  );
  const args = parseArgs(["--config", configPath]);
  assert.equal(args.model, "m");
  assert.equal(args.promptsPath, "p.txt");
  assert.equal(args.outPath, "o.jsonl");
  assert.equal(args.apiBase, "https://openrouter.ai/api/v1");
  assert.equal(args.systemPrompt, "line1\nline2");
  assert.equal(args.storeSystem, false);
  assert.equal(args.concurrent, 3);
  assert.equal(args.openrouterIsFree, true);
  assert.deepEqual(args.openrouterProviderOrder, ["openai", "anthropic"]);
  assert.equal(args.openrouterProviderSort, "throughput");
  assert.equal(args.reasoningEffort, "high");
  assert.equal(args.progress, false);
});

test("parseArgs lets CLI override config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "datagen-"));
  const configPath = join(dir, "config.yaml");
  await writeFile(configPath, ["model: a", "prompts: p.txt", ""].join("\n"));
  const args = parseArgs(["--config", configPath, "--model", "b"]);
  assert.equal(args.model, "b");
  assert.equal(args.promptsPath, "p.txt");
});

test("buildRequestMessages omits system when empty", () => {
  const msgs = buildRequestMessages("", "hi");
  assert.deepEqual(msgs, [{ role: "user", content: "hi" }]);
});

test("buildOutputMessages respects storeSystem flag", () => {
  const withStore = buildOutputMessages("sys", "u", "a", true);
  assert.deepEqual(withStore, [
    { role: "system", content: "sys" },
    { role: "user", content: "u" },
    { role: "assistant", content: "a" }
  ]);

  const withoutStore = buildOutputMessages("sys", "u", "a", false);
  assert.deepEqual(withoutStore, [
    { role: "user", content: "u" },
    { role: "assistant", content: "a" }
  ]);
});

test("formatAssistantContent wraps reasoning in <think>", () => {
  const out = formatAssistantContent("answer", "reasoning here");
  assert.equal(out, "<think>reasoning here</think>\nanswer");
});

test("callOpenRouter sends correct payload and parses reasoning", async () => {
  const calls: any[] = [];

  // @ts-expect-error overriding global fetch for test
  globalThis.fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: "hello",
                reasoning: "r"
              }
            }
          ]
        };
      }
    } as any;
  };

  const res = await callOpenRouter(
    "https://openrouter.ai/api/v1",
    "KEY",
    "model-x",
    "sys",
    "user",
    undefined
  );

  assert.equal(res.content, "hello");
  assert.equal(res.reasoning, "r");

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /chat\/completions$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "model-x");
  assert.deepEqual(body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "user" }
  ]);
  assert.equal(body.provider, undefined);
  assert.equal(body.reasoning, undefined);
});

test("callOpenRouter includes provider prefs when provided", async () => {
  const calls: any[] = [];

  // @ts-expect-error overriding global fetch for test
  globalThis.fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: "hello"
              }
            }
          ]
        };
      }
    } as any;
  };

  await callOpenRouter(
    "https://openrouter.ai/api/v1",
    "KEY",
    "model-x",
    "",
    "user",
    { order: ["openai"], sort: "throughput" }
  );

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.provider, { order: ["openai"], sort: "throughput" });
});

test("callOpenRouter includes reasoning.effort when provided", async () => {
  const calls: any[] = [];

  // @ts-expect-error overriding global fetch for test
  globalThis.fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: "hello"
              }
            }
          ]
        };
      }
    } as any;
  };

  await callOpenRouter(
    "https://openrouter.ai/api/v1",
    "KEY",
    "model-x",
    "",
    "user",
    undefined,
    "high"
  );

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.reasoning, { effort: "high" });
});

test("callOpenRouter reasoning.effort works for non-OpenRouter apiBase", async () => {
  const calls: any[] = [];

  // @ts-expect-error overriding global fetch for test
  globalThis.fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content: "hello"
              }
            }
          ]
        };
      }
    } as any;
  };

  await callOpenRouter(
    "https://example.com/api/v1",
    "KEY",
    "model-x",
    "",
    "user",
    undefined,
    "minimal"
  );

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.reasoning, { effort: "minimal" });
});

test("ensureReadableFile throws if missing or not a file", async () => {
  await assert.rejects(
    () => ensureReadableFile("does-not-exist.txt"),
    /File not found/
  );

  const dir = await mkdtemp(join(tmpdir(), "datagen-"));
  await assert.rejects(() => ensureReadableFile(dir), /Not a file/);

  const file = join(dir, "prompts.txt");
  await writeFile(file, "hello\n");
  await ensureReadableFile(file);
});
