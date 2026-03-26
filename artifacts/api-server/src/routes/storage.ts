import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  LocalStorageService,
  ObjectNotFoundError,
  createStorageService,
  isLocalStorageMode,
} from "../lib/objectStorage";
import { requireRole } from "../middleware/auth";
import { db, invoiceDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const storageService = createStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 *
 * In local mode: returns a URL pointing to PUT /storage/uploads/local/:uuid.
 * In GCS mode: returns a signed GCS URL.
 */
router.post("/storage/uploads/request-url", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    if (isLocalStorageMode()) {
      const localService = storageService as LocalStorageService;
      const uuid = localService.generateUploadId();
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const uploadURL = `${baseUrl}${localService.getUploadEndpointPath(uuid)}`;
      const objectPath = `/objects/uploads/${uuid}`;

      localService.saveMetadata(uuid, contentType ?? "application/octet-stream");

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } else {
      const gcsService = storageService as ObjectStorageService;
      const uploadURL = await gcsService.getObjectEntityUploadURL();
      const objectPath = gcsService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    }
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * PUT /storage/uploads/local/:uuid
 *
 * Local-mode only. Receives raw binary body and saves to disk.
 * The upload URL returned by request-url points here.
 */
router.put("/storage/uploads/local/:uuid", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  if (!isLocalStorageMode()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { uuid } = req.params;
  if (!uuid || !/^[0-9a-f-]{36}$/.test(uuid)) {
    res.status(400).json({ error: "Invalid upload ID" });
    return;
  }

  try {
    const localService = storageService as LocalStorageService;
    const filePath = localService.getLocalFilePath(uuid);

    const { createWriteStream } = await import("fs");
    const writeStream = createWriteStream(filePath);

    await new Promise<void>((resolve, reject) => {
      req.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      req.on("error", reject);
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Error saving local upload");
    res.status(500).json({ error: "Failed to save file" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets. In GCS mode: from PUBLIC_OBJECT_SEARCH_PATHS.
 * In local mode: from uploads/public/ directory.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await storageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await storageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities. Requires authentication.
 * internal_lawyer users can only access files linked to invoice documents.
 */
router.get("/storage/objects/*path", requireRole("super_admin", "legal_ops", "internal_lawyer"), async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const userRole = req.session.userRole;
    const isSuperAdminOrLegalOps = userRole === "super_admin" || userRole === "legal_ops";

    if (!isSuperAdminOrLegalOps) {
      const [doc] = await db
        .select({ id: invoiceDocumentsTable.id })
        .from(invoiceDocumentsTable)
        .where(eq(invoiceDocumentsTable.storagePath, objectPath))
        .limit(1);

      if (!doc) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const objectFile = await storageService.getObjectEntityFile(objectPath);

    const response = await storageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
