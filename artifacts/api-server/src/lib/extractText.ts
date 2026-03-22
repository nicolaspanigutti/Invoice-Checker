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

  if (mime.startsWith("image/")) {
    return "";
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword"
  ) {
    return buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ").trim();
  }

  return buffer.toString("utf-8").slice(0, 20000);
}
