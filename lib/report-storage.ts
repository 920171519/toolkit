import "server-only";

import { randomUUID } from "node:crypto";
import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";
import { REPORT_STORAGE_KEY_PREFIX, resolveReportStoragePath } from "./runtime-config";

function readableSegment(value: string, limit: number, fallback: string) {
  const sanitized = Array.from(value.normalize("NFC"), (character) =>
    character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "_" : character,
  ).join("").trim();
  return Array.from(sanitized).slice(0, limit).join("").replace(/[ .]+$/, "") || fallback;
}

export function reportArchivePath(
  batch: { id: number; code: string; project_id: number; project_name: string },
  originalName: string,
  extension: string,
) {
  const projectFolder = `${batch.project_id}-${readableSegment(batch.project_name, 36, "项目")}`;
  const batchFolder = /^B\d{3,24}$/.test(batch.code) ? batch.code : `批次-${batch.id}`;
  const filename = readableSegment(win32.parse(originalName).name, 36, "验证报告");
  return posix.join(REPORT_STORAGE_KEY_PREFIX, projectFolder, batchFolder, `${filename}-${randomUUID()}${extension}`);
}

export function resolveReportPath(storedPath: string) {
  const storedRoot = resolve(/* turbopackIgnore: true */ process.cwd(), REPORT_STORAGE_KEY_PREFIX);
  const normalizedPath = storedPath.replaceAll("\\", "/");
  if (posix.isAbsolute(normalizedPath) || win32.isAbsolute(normalizedPath)) return null;
  const storagePath = resolve(/* turbopackIgnore: true */ process.cwd(), normalizedPath);
  const insideRoot = relative(storedRoot, storagePath);
  if (!insideRoot || insideRoot === ".." || insideRoot.startsWith(`..${sep}`) || isAbsolute(insideRoot)) return null;
  return resolveReportStoragePath(storagePath, insideRoot);
}
