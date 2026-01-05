# Config

Use `--config <file>` to load CLI options from a YAML or JSON file.

## Precedence

Command-line flags override values from the config file.

## Keys

- Use the same names as the CLI flags, but without the leading `--` (example: `model`, `prompts`, `store-system`).
- Dot keys work (example: `openrouter.providerSort`).
- You can also use nested YAML objects; they get flattened into dot keys (example below).

## Values

- Strings, numbers, booleans are supported.
- Lists are supported for keys like `openrouter.provider` (they become comma-separated internally).
- YAML block strings (`|` / `>`) are supported for multi-line values like `system`.

## Example (`config.yaml`)

```yaml
model: openai/gpt-4o-mini
prompts: ./prompts.txt
out: ./dataset.jsonl
api: https://openrouter.ai/api/v1
system: |
  You are a helpful assistant.
  Answer concisely.
store-system: true
concurrent: 2
reasoningEffort: high
openrouter:
  provider:
    - openai
    - anthropic
  providerSort: throughput
timeout: 60000
no-progress: true
```

Run:

```bash
datagen --config config.yaml
```

