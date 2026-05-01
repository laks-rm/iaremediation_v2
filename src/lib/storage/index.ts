import { promises as fs } from "node:fs";
import path from "node:path";

function normalizeStoragePath(filePath: string) {
  if (!filePath || path.isAbsolute(filePath) || filePath.includes("\0")) {
    throw new Error("Invalid storage path");
  }

  const normalized = path.posix.normalize(filePath.replaceAll("\\", "/"));

  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error("Invalid storage path");
  }

  return normalized;
}

async function getGcsBucket() {
  const bucketName = process.env.GCS_BUCKET_NAME;

  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is required when STORAGE_PROVIDER is gcs");
  }

  const packageName = "@google-cloud/storage";
  const { Storage } = (await import(packageName)) as typeof import("@google-cloud/storage");
  const storage = new Storage();

  return storage.bucket(bucketName);
}

function getLocalPath(filePath: string) {
  const uploadsRoot = path.join(process.cwd(), "uploads");
  const normalizedPath = normalizeStoragePath(filePath);
  const absolutePath = path.resolve(uploadsRoot, normalizedPath);

  if (!absolutePath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error("Invalid storage path");
  }

  return { absolutePath, normalizedPath };
}

export async function uploadFile(
  buffer: Buffer,
  filePath: string,
  mimeType: string,
): Promise<string> {
  if (!Buffer.isBuffer(buffer) || !mimeType.trim()) {
    throw new Error("Invalid file upload input");
  }

  const normalizedPath = normalizeStoragePath(filePath);

  if (process.env.STORAGE_PROVIDER === "gcs") {
    const bucket = await getGcsBucket();
    await bucket.file(normalizedPath).save(buffer, {
      contentType: mimeType,
      resumable: false,
    });

    return normalizedPath;
  }

  const { absolutePath } = getLocalPath(normalizedPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  return normalizedPath;
}

export async function getFileStream(filePath: string): Promise<Buffer> {
  const normalizedPath = normalizeStoragePath(filePath);

  if (process.env.STORAGE_PROVIDER === "gcs") {
    const bucket = await getGcsBucket();
    const [buffer] = await bucket.file(normalizedPath).download();

    return buffer;
  }

  const { absolutePath } = getLocalPath(normalizedPath);

  return fs.readFile(absolutePath);
}

export async function deleteFile(filePath: string): Promise<void> {
  const normalizedPath = normalizeStoragePath(filePath);

  if (process.env.STORAGE_PROVIDER === "gcs") {
    const bucket = await getGcsBucket();
    await bucket.file(normalizedPath).delete({ ignoreNotFound: true });
    return;
  }

  const { absolutePath } = getLocalPath(normalizedPath);
  await fs.rm(absolutePath, { force: true });
}
