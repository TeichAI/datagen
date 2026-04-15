# DataGen – By TeichAI

A simple CLI to generate JSONL datasets from a text file using LLMs.

## Installation

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

## Quick Start

Set your OpenRouter API key:

```bash
export API_KEY="your_openrouter_key"
```

Create a `prompts.txt` file where each line is a prompt:

```
Explain the CAP theorem in simple terms.
Write a Python function to reverse a linked list.
```

Run the CLI:

```bash
datagen --model openai/gpt-4o-mini --prompts prompts.txt
```

## Configuration File

You can also use a YAML config file. Example:

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

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--help` | Show help message | – |
| `--version` | Print CLI version | – |
| `--config <file>` | Path to config file | – |
| `--model <name>` | Model name (required) | – |
| `--prompts <file>` | Prompts file (required) | – |
| `--out <file>` | Output JSONL | `dataset.jsonl` |
| `--api <baseUrl>` | API base URL | OpenRouter |
| `--system <text>` | System prompt | – |
| `--store-system <true|false>` | Store system message in output | `true` |
| `--concurrent <num>` | Number of concurrent requests | `1` |
| `--openrouter.provider <slugs>` | Provider slugs order (OpenRouter only) | – |
| `--openrouter.providerSort <price|throughput|latency>` | Provider routing sort (OpenRouter only) | – |
| `--reasoningEffort <none|minimal|low|medium|high|xhigh>` | Reasoning effort | – |
| `--no-progress` | Disable progress bar | – |
| `--timeout <ms>` | Request timeout in ms | – |

## Development

```bash
API_KEY="your_openrouter_key" npm run dev -- --model openai/gpt-4o-mini --prompts prompts.txt
```

## Update Check

On startup, `datagen` performs a quick check for a newer npm version and prints an upgrade command if available. Disable with `DATAGEN_DISABLE_UPDATE_CHECK=1`.