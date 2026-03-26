import { Storage, File as GCSFile } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export type StorageFile =
  | { type: "gcs"; file: GCSFile }
  | { type: "local"; filePath: string; contentType: string };

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Local filesystem storage (no cloud dependencies)
// ---------------------------------------------------------------------------

export class LocalStorageService {
  private uploadsDir: string;

  constructor() {
    this.uploadsDir = process.env.UPLOADS_PATH
      ? path.resolve(process.env.UPLOADS_PATH)
      : path.join(process.cwd(), "uploads");
    fs.mkdirSync(this.uploadsDir, { recursive: true });
  }

  getUploadEndpointPath(uuid: string): string {
    return `/api/storage/uploads/local/${uuid}`;
  }

  generateUploadId(): string {
    return randomUUID();
  }

  getLocalFilePath(uuid: string): string {
    return path.join(this.uploadsDir, uuid);
  }

  getMetaFilePath(uuid: string): string {
    return path.join(this.uploadsDir, `${uuid}.meta.json`);
  }

  saveMetadata(uuid: string, contentType: string): void {
    fs.writeFileSync(this.getMetaFilePath(uuid), JSON.stringify({ contentType }));
  }

  readMetadata(uuid: string): { contentType: string } {
    try {
      return JSON.parse(fs.readFileSync(this.getMetaFilePath(uuid), "utf-8"));
    } catch {
      return { contentType: "application/octet-stream" };
    }
  }

  normalizeObjectEntityPath(rawPath: string): string {
    const match = rawPath.match(/\/api\/storage\/uploads\/local\/([^/?]+)/);
    if (match) {
      return `/objects/uploads/${match[1]}`;
    }
    return rawPath;
  }

  async getObjectEntityFile(objectPath: string): Promise<StorageFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();

    const uuid = parts.slice(1).join("/");
    const filePath = this.getLocalFilePath(uuid);

    if (!fs.existsSync(filePath)) throw new ObjectNotFoundError();

    const { contentType } = this.readMetadata(uuid);
    return { type: "local", filePath, contentType };
  }

  async downloadObject(file: StorageFile): Promise<Response> {
    if (file.type !== "local") throw new Error("Expected local file");

    const stat = fs.statSync(file.filePath);
    const nodeStream = fs.createReadStream(file.filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(stat.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  async searchPublicObject(filePath: string): Promise<StorageFile | null> {
    const resolved = path.join(this.uploadsDir, "public", filePath);
    if (!fs.existsSync(resolved)) return null;
    return { type: "local", filePath: resolved, contentType: "application/octet-stream" };
  }

  async trySetObjectEntityAclPolicy(rawPath: string, _aclPolicy: ObjectAclPolicy): Promise<string> {
    return this.normalizeObjectEntityPath(rawPath);
  }

  async canAccessObjectEntity(_opts: { userId?: string; objectFile: StorageFile; requestedPermission?: ObjectPermission }): Promise<boolean> {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Storage (Replit-hosted or service account)
// ---------------------------------------------------------------------------

async function getObjectAclPolicy(file: GCSFile): Promise<ObjectAclPolicy | null> {
  const [metadata] = await file.getMetadata();
  const raw = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!raw) return null;
  return JSON.parse(raw as string) as ObjectAclPolicy;
}

async function setObjectAclPolicy(file: GCSFile, aclPolicy: ObjectAclPolicy): Promise<void> {
  await file.setMetadata({ metadata: { [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy) } });
}

async function canAccessGCSObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: GCSFile;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) return false;
  if (aclPolicy.visibility === "public" && requestedPermission === ObjectPermission.READ) return true;
  if (!userId) return false;
  return aclPolicy.owner === userId;
}

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<StorageFile | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return { type: "gcs", file };
      }
    }

    return null;
  }

  async downloadObject(file: StorageFile): Promise<Response> {
    if (file.type !== "gcs") throw new Error("Expected GCS file");

    const [metadata] = await file.file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file.file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=3600`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<StorageFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return { type: "gcs", file: objectFile };
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    if (objectFile.type === "gcs") {
      await setObjectAclPolicy(objectFile.file, aclPolicy);
    }
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StorageFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    if (objectFile.type !== "gcs") return true;
    return canAccessGCSObject({
      userId,
      objectFile: objectFile.file,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory — auto-selects local or GCS based on LOCAL_STORAGE env var
// ---------------------------------------------------------------------------

export function isLocalStorageMode(): boolean {
  return process.env.LOCAL_STORAGE === "true" || !process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
}

export function createStorageService(): ObjectStorageService | LocalStorageService {
  if (isLocalStorageMode()) {
    return new LocalStorageService();
  }
  return new ObjectStorageService();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const body = await response.json() as { signed_url: string };
  return body.signed_url;
}
