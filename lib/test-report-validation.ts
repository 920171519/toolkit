const reportMediaTypes = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".txt", "text/plain; charset=utf-8"],
  [".zip", "application/zip"],
]);

export const testReportAccept = [...reportMediaTypes.keys()].join(",");
export const testReportHint = "PDF、图片、Word、Excel、TXT 或 ZIP，最大 15 MB";

function reportExtension(name: string) {
  const filename = name.split(/[\\/]/).at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

const plainTextMediaType = /^[ \t]*text\/plain(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:[a-z0-9][a-z0-9._-]*|"[a-z0-9][a-z0-9._-]*"))?[ \t]*$/i;

export function getTestReportMediaType(name: string, storedMediaType: unknown) {
  const extension = reportExtension(name);
  if (extension === ".txt" && typeof storedMediaType === "string" && plainTextMediaType.test(storedMediaType)) {
    return storedMediaType.trim();
  }
  return reportMediaTypes.get(extension);
}

export function readTestReport(file: Pick<File, "name" | "size">): { extension: string; error?: never } | { extension?: never; error: string } {
  if (file.size === 0) return { error: "请选择非空的验证报告文件。" };
  if (file.size > 15 * 1024 * 1024) return { error: "验证报告不能超过 15 MB。" };
  const extension = reportExtension(file.name);
  return reportMediaTypes.has(extension) ? { extension } : { error: "验证报告仅支持 PDF、图片、Word、Excel、TXT 或 ZIP 文件。" };
}
