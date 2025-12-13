import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";

export async function countNonEmptyLines(filePath: string): Promise<number> {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity
  });

  let count = 0;
  for await (const line of rl) {
    if (line.trim().length > 0) count++;
  }
  rl.close();
  return count;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export type ProgressStats = { ok: number; err: number };

export class ProgressBar {
  private readonly total: number;
  private readonly stream: Writable & { columns?: number; isTTY?: boolean };
  private readonly start = Date.now();
  private lastLine = "";

  constructor(
    total: number,
    stream: Writable & { columns?: number; isTTY?: boolean }
  ) {
    this.total = Math.max(0, total);
    this.stream = stream;
  }

  private clearLine() {
    this.stream.write("\x1b[2K\r");
  }

  writeLine(text: string) {
    this.clearLine();
    this.stream.write(text + "\n");
    this.lastLine = "";
  }

  render(current: number, stats?: ProgressStats) {
    const safeCurrent = Math.max(0, current);
    const denom = this.total > 0 ? this.total : 1;
    const pct = Math.min(1, safeCurrent / denom);
    const percentLabel = String(Math.floor(pct * 100)).padStart(3, " ") + "%";

    const columns = typeof this.stream.columns === "number" ? this.stream.columns : 80;
    const suffixBase = ` ${safeCurrent}/${this.total}`;
    const suffixStats = stats ? ` ok=${stats.ok} err=${stats.err}` : "";
    const suffixTime = ` ${formatDuration(Date.now() - this.start)}`;
    const suffix = suffixBase + suffixStats + suffixTime;

    const barWidth = Math.max(10, Math.min(40, columns - suffix.length - 10));
    const filled = Math.round(barWidth * pct);
    const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));

    const line = `${percentLabel} [${bar}]${suffix}`;
    if (line === this.lastLine) return;

    this.clearLine();
    this.stream.write(line);
    this.lastLine = line;
  }

  finish(current: number, stats?: ProgressStats) {
    this.render(current, stats);
    this.stream.write("\n");
  }
}

