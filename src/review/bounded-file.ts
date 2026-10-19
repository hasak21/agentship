import { constants } from "node:fs";
import { open } from "node:fs/promises";

const MAX_AGGREGATE_EVIDENCE_BYTES = 64 * 1024 * 1024;

export class EvidenceReadBudget {
  private charged = 0;

  constructor(private readonly label: string, private readonly maximum = MAX_AGGREGATE_EVIDENCE_BYTES) {
    if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > MAX_AGGREGATE_EVIDENCE_BYTES) {
      throw new Error(`Evidence byte budget must be between 1 and ${MAX_AGGREGATE_EVIDENCE_BYTES}.`);
    }
  }

  async read(file: string, label: string, perFileMaximum: number): Promise<Buffer> {
    if (!Number.isSafeInteger(perFileMaximum) || perFileMaximum <= 0 || perFileMaximum > MAX_AGGREGATE_EVIDENCE_BYTES) {
      throw new Error(`Per-file evidence byte limit must be between 1 and ${MAX_AGGREGATE_EVIDENCE_BYTES}.`);
    }
    const remaining = this.maximum - this.charged;
    const exhausted = `${this.label} exceeds ${this.maximum} aggregate byte budget`;
    if (remaining <= 0) throw new Error(exhausted);
    const allowance = Math.min(remaining, perFileMaximum);
    // Reserve before awaiting so concurrent callers cannot overspend the budget.
    // Failed reads keep their reservation; only successful short reads refund it.
    this.charged += allowance;
    const source = await readBoundedRegularFile(file, allowance < perFileMaximum ? `${exhausted} while reading ${label}` : label, allowance);
    this.charged -= allowance - source.length;
    return source;
  }
}

export function decodeUtf8Input(source: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    throw new Error(`${label} must contain valid UTF-8; refusing replacement-decoded input.`);
  }
}

export async function readBoundedRegularFile(
  filePath: string,
  label: string,
  maxBytes: number
): Promise<Buffer> {
  // Type-check the opened object without waiting for a FIFO writer. Regular-file
  // reads are unchanged; links to regular files remain compatible input paths.
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new Error(
        `${label} must be a regular file of at most ${maxBytes} bytes.`
      );
    }

    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) {
      throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
