const extensions = [".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx", ".txt", ".zip"];

export const testReportAccept = extensions.join(",");
export const testReportHint = "PDF、图片、Word、Excel、TXT 或 ZIP，最大 15 MB";

export function readTestReport(file: Pick<File, "name" | "size">): { extension: string; error?: never } | { extension?: never; error: string } {
  if (file.size === 0) return { error: "请选择非空的验证报告文件。" };
  if (file.size > 15 * 1024 * 1024) return { error: "验证报告不能超过 15 MB。" };
  const filename = file.name.split(/[\\/]/).at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  const extension = dot > 0 ? filename.slice(dot).toLowerCase() : "";
  return extensions.includes(extension) ? { extension } : { error: "验证报告仅支持 PDF、图片、Word、Excel、TXT 或 ZIP 文件。" };
}
