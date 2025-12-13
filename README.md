# DataGen - By TeichAI

A easy to use CLI to generate JSONL datasets from a TXT file using LLMs.

## Install

```bash
npm install
npm run build
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

Development (build + run once):

```bash
API_KEY="your_openrouter_key" npm run dev -- --model openai/gpt-4o-mini --prompts prompts.txt
```

### Options

- `--model <name>`: required model name.
- `--prompts <file>`: required prompts file.
- `--out <file>`: output JSONL (default `dataset.jsonl`).
- `--api <baseUrl>`: API base (default OpenRouter).
- `--system <text>`: optional system prompt.
- `--store-system true|false`: store system message in output (default `true`).
- `--concurrent <num>`: number of in-flight requests (default `1`).
- `--no-progress`: disable the progress bar.
