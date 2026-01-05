# DataGen - By TeichAI

A easy to use CLI to generate JSONL datasets from a TXT file using LLMs.

## Install

```bash
npm i -g @teichai/datagen
```

Or install locally and run via `npx`:

```bash
npm i -D @teichai/datagen
npx datagen --help
```

Run tests:

```bash
npm test
```

## Usage

Set your OpenRouter API key:

```bash
export API_KEY="your_openrouter_key"
```

Create a prompts file where each line is a prompt:

```text
Explain the CAP theorem in simple terms.
Write a Python function to reverse a linked list.
```

Run:

```bash
datagen --model openai/gpt-4o-mini --prompts prompts.txt
```

### Configuration File

You can also use a YAML config file:

```yaml
model: openai/gpt-4o-mini
prompts: ./prompts.txt
out: ./dataset.jsonl
concurrent: 5
openrouter:
  providerSort: throughput
```

Run with:

```bash
datagen --config config.yaml
```

Note: On startup, `datagen` does a quick best-effort check for a newer npm version and prints an upgrade command if available. Disable with `DATAGEN_DISABLE_UPDATE_CHECK=1`.

Development (build + run once):

```bash
API_KEY="your_openrouter_key" npm run dev -- --model openai/gpt-4o-mini --prompts prompts.txt
```

### Options

- `--help`: show the help message and exit.
- `--version`: print the CLI version and exit.
- `--config`: set a config file
- `--model <name>`: required model name.
- `--prompts <file>`: required prompts file.
- `--out <file>`: output JSONL (default `dataset.jsonl`).
- `--api <baseUrl>`: API base (default OpenRouter).
- `--system <text>`: optional system prompt.
- `--store-system true|false`: store system message in output (default `true`).
- `--concurrent <num>`: number of in-flight requests (default `1`).
- `--openrouter.provider <slugs>`: comma-separated provider slugs to try in order (OpenRouter only).
- `--openrouter.providerSort <price|throughput|latency>`: provider routing sort (OpenRouter only).
- `--reasoningEffort <none|minimal|low|medium|high|xhigh>`: pass through as `reasoning.effort`.
- `--no-progress`: disable the progress bar.
- `--timeout <ms>`: request timeout in milliseconds.