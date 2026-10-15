import { open } from "node:fs/promises";

export async function readBoundedRegularFile(
  filePath: string,
  label: string,
  maxBytes: number
): Promise<Buffer> {
  const handle = await open(filePath, "r");
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
