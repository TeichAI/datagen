import { readFileSync } from "node:fs";

type Scalar = string | number | boolean | null;
type JsonValue = Scalar | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

function parseDoubleQuoted(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = input[i + 1];
    if (next === undefined) {
      out += "\\";
      continue;
    }
    i++;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "\"") out += "\"";
    else if (next === "\\") out += "\\";
    else out += next;
  }
  return out;
}

function splitFlowList(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (quote === "'" && ch === "'" && inner[i + 1] === "'") {
        cur += "'";
        i++;
        continue;
      }
      if (quote === "\"" && ch === "\\") {
        const next = inner[i + 1];
        if (next !== undefined) {
          cur += ch + next;
          i++;
          continue;
        }
      }
      if (ch === quote) {
        quote = null;
        cur += ch;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  const last = cur.trim();
  if (last.length > 0) out.push(last);
  return out;
}

function parseScalar(raw: string): JsonValue {
  const v = raw.trim();
  if (v === "null" || v === "~") return null;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner.length === 0) return [];
    const parts = splitFlowList(inner);
    return parts.map((p) => parseScalar(p)) as JsonValue[];
  }
  if (v.startsWith("\"") && v.endsWith("\"") && v.length >= 2) {
    return parseDoubleQuoted(v.slice(1, -1));
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

function parseYaml(text: string): JsonObject {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let i = 0;

  const root: JsonObject = {};
  type Frame = { indent: number; value: JsonObject | JsonValue[]; pendingKey?: string; pendingIndent?: number };
  const stack: Frame[] = [{ indent: -1, value: root }];

  const popToIndent = (indent: number) => {
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
  };

  const ensurePendingContainer = (indent: number, nextTrimmed: string) => {
    const frame = stack[stack.length - 1];
    if (!frame.pendingKey || frame.pendingIndent === undefined) return;
    if (indent <= frame.pendingIndent) return;
    if (Array.isArray(frame.value)) throw new Error("Invalid YAML structure.");
    const container: JsonObject | JsonValue[] = nextTrimmed.startsWith("-") ? [] : {};
    frame.value[frame.pendingKey] = container as any;
    const childIndent = frame.pendingIndent;
    frame.pendingKey = undefined;
    frame.pendingIndent = undefined;
    stack.push({ indent: childIndent, value: container });
  };

  const parseBlockScalar = (baseIndent: number, style: "|" | ">") => {
    const collected: { indent: number; text: string }[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (line.trim().length === 0) {
        collected.push({ indent: baseIndent + 1, text: "" });
        j++;
        continue;
      }
      if (line.includes("\t")) throw new Error("YAML tabs are not supported.");
      const indent = line.match(/^ */)?.[0].length ?? 0;
      if (indent <= baseIndent) break;
      collected.push({ indent, text: line });
      j++;
    }
    i = j - 1;
    const nonEmptyIndents = collected
      .filter((l) => l.text.trim().length > 0)
      .map((l) => l.indent);
    const blockIndent =
      nonEmptyIndents.length > 0 ? Math.min(...nonEmptyIndents) : baseIndent + 2;
    const normalized = collected.map((l) =>
      l.text.trim().length === 0 ? "" : l.text.slice(blockIndent)
    );
    if (style === "|") return normalized.join("\n");
    const folded: string[] = [];
    for (let k = 0; k < normalized.length; k++) {
      const line = normalized[k];
      if (line.trim().length === 0) {
        folded.push("\n");
        continue;
      }
      if (folded.length === 0 || folded[folded.length - 1] === "\n") folded.push(line);
      else folded[folded.length - 1] += " " + line;
    }
    return folded.join("");
  };

  for (; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim().length === 0) continue;
    const trimmedStart = rawLine.trimStart();
    if (trimmedStart.startsWith("#")) continue;
    if (rawLine.includes("\t")) throw new Error("YAML tabs are not supported.");
    const indent = rawLine.length - trimmedStart.length;

    popToIndent(indent);
    ensurePendingContainer(indent, trimmedStart);

    const frame = stack[stack.length - 1];
    const container = frame.value;

    if (trimmedStart.startsWith("-")) {
      if (!Array.isArray(container)) throw new Error("Invalid YAML structure.");
      const rest = trimmedStart.slice(1).trimStart();
      if (rest.length === 0) throw new Error("Nested sequence items are not supported.");
      container.push(parseScalar(rest));
      continue;
    }

    if (Array.isArray(container)) throw new Error("Invalid YAML structure.");
    const colonIdx = trimmedStart.indexOf(":");
    if (colonIdx <= 0) throw new Error(`Invalid YAML line: ${trimmedStart}`);
    const rawKey = trimmedStart.slice(0, colonIdx).trim();
    if (rawKey.length === 0) throw new Error(`Invalid YAML line: ${trimmedStart}`);
    const key =
      rawKey.startsWith("\"") && rawKey.endsWith("\"") && rawKey.length >= 2
        ? parseDoubleQuoted(rawKey.slice(1, -1))
        : rawKey.startsWith("'") && rawKey.endsWith("'") && rawKey.length >= 2
          ? rawKey.slice(1, -1).replace(/''/g, "'")
          : rawKey;

    const afterColon = trimmedStart.slice(colonIdx + 1).trimStart();
    if (afterColon.length === 0) {
      frame.pendingKey = key;
      frame.pendingIndent = indent;
      continue;
    }

    if (afterColon === "|" || afterColon === ">") {
      container[key] = parseBlockScalar(indent, afterColon);
      continue;
    }

    container[key] = parseScalar(afterColon);
  }

  return root;
}

function flattenConfig(value: JsonValue, prefix: string, out: Record<string, JsonValue>) {
  if (value === null) return;
  if (Array.isArray(value)) {
    out[prefix] = value;
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const next = prefix.length > 0 ? `${prefix}.${k}` : k;
      flattenConfig(v, next, out);
    }
    return;
  }
  out[prefix] = value;
}

const CONFIG_KEY_ALIASES: Record<string, string> = {
  promptsPath: "prompts",
  outPath: "out",
  apiBase: "api",
  storeSystem: "store-system",
  noProgress: "no-progress",
  openrouterProviderOrder: "openrouter.provider",
  openrouterProviderSort: "openrouter.providerSort"
};

function normalizeConfigKey(key: string): string {
  const trimmed = key.trim();
  const withoutPrefix = trimmed.startsWith("--") ? trimmed.slice(2) : trimmed;
  return CONFIG_KEY_ALIASES[withoutPrefix] ?? withoutPrefix;
}

function toCliRawValue(value: JsonValue): string | boolean {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value;
  if (value === null) return "";
  if (Array.isArray(value)) {
    const parts = value.map((v) => {
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      throw new Error("Unsupported array value in config.");
    });
    return parts.join(",");
  }
  throw new Error("Unsupported config value.");
}

export function loadConfigRawArgs(configPath: string): Record<string, string | boolean> {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new Error(`Config file not found: ${configPath}`);
    throw err;
  }

  const trimmed = text.trimStart();
  const parsed: JsonValue =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? (JSON.parse(text) as any)
      : (parseYaml(text) as any);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config must be a YAML/JSON object at the root.");
  }

  const flat: Record<string, JsonValue> = {};
  flattenConfig(parsed as JsonObject, "", flat);

  const out: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (k.trim().length === 0) continue;
    out[normalizeConfigKey(k)] = toCliRawValue(v);
  }
  return out;
}
