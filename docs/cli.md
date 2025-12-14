# CLI

## Name

`datagen`

## Version

`datagen --version`

## Help

`datagen --help`

## Usage

```bash
datagen --model <model> --prompts <file> [options]
```

Required:

- `--model <name>`
- `--prompts <file>`

## Options

- `--help`, `-h` Show help and exit.
- `--version`, `-v` Print version and exit.
- `--config <file>` Load options from a YAML/JSON config file (CLI flags override config).
- `--model <name>` Model name to use for completions.
- `--prompts <file>` Path to a file where each non-empty line is a prompt.
- `--out <file>` Output JSONL file (default: `dataset.jsonl`).
- `--api <baseUrl>` API base URL (default: `https://openrouter.ai/api/v1`).
- `--system <text>` Optional system prompt to include.
- `--store-system true|false` Whether to emit the system prompt in the dataset (default: `true`).
- `--concurrent <num>` Number of parallel requests (default: `1`).
- `--openrouter.provider <slugs>` OpenRouter provider slugs (comma-separated list).
- `--openrouter.providerSort <x>` Provider sorting order (`price|throughput|latency`).
- `--reasoningEffort <level>` Reasoning effort (`none|minimal|low|medium|high|xhigh`).
- `--no-progress` Disable the progress bar.

## Environment

- `API_KEY` Required. Set to your OpenRouter API key.

## Config file

See `docs/config.md`.

## Output

Writes a JSONL file to `--out` (default `dataset.jsonl`).

## Errors

Common error cases:

- Missing required args: prints a usage line and exits with code `1`.
- Missing `API_KEY`: prints `Missing env var "API_KEY".` and exits with code `1`.
- Prompts file missing/unreadable: prints an error (for example `File not found: ...`) and exits with code `1`.
- Invalid `--config` path or invalid YAML/JSON: prints an error and exits with code `1`.

## Examples

Minimal:

```bash
API_KEY=... datagen --model openai/gpt-4o-mini --prompts prompts.txt
```

With output + concurrency:

```bash
API_KEY=... datagen --model openai/gpt-4o-mini --prompts prompts.txt --out dataset.jsonl --concurrent 4
```

With config:

```bash
API_KEY=... datagen --config config.yaml
```

