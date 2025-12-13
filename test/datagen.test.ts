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
    "user"
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
