import { createRequire } from "module";

const require = createRequire(import.meta.url);

export async function extractTextFromBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  const mime = mimeType.toLowerCase();

  if (mime === "application/pdf") {
    try {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      return data.text ?? "";
    } catch {
      return "";
    }
  }

  if (mime === "text/plain") {
    return buffer.toString("utf-8");
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword"
  ) {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? "";
    } catch {
      return buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ").trim();
    }
  }

  return buffer.toString("utf-8").slice(0, 20000);
}

export function imageBufferToBase64(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
