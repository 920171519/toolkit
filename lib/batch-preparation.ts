export const DRAFT_CREATED_MESSAGE = "转测草稿已保存。核对配套后即可发起集成测试。";

export function batchSelectionKey(userId: number, projectId: number) {
  return `toolkit.batch-selection:${userId}:${projectId}`;
}

export function readTransferRequestId(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

export function draftRequestListState(params: { fromRequests?: unknown; request?: unknown }) {
  return params.fromRequests === "1"
    ? { fromRequests: "1" as const, request: readTransferRequestId(params.request) }
    : {};
}
