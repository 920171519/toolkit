export const DRAFT_CREATED_MESSAGE = "转测草稿已保存。核对配套后即可发起集成测试。";

export function batchSelectionKey(userId: number, projectId: number) {
  return `toolkit.batch-selection:${userId}:${projectId}`;
}
