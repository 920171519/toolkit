import type { ProjectStatus } from "./domain-values";

export const PROJECT_STAGES = ["TR1", "TR2", "TR3", "TR4", "TR5", "TR6", "ENDED"] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const DEFAULT_PROJECT_STAGE: ProjectStage = "TR1";

export const PROJECT_STAGE_META: Record<ProjectStage, { label: string; tone: string }> = {
  TR1: { label: "TR1", tone: "sky" },
  TR2: { label: "TR2", tone: "sky" },
  TR3: { label: "TR3", tone: "sky" },
  TR4: { label: "TR4", tone: "sky" },
  TR5: { label: "TR5", tone: "sky" },
  TR6: { label: "TR6", tone: "sky" },
  ENDED: { label: "已结束", tone: "slate" },
};

export function isProjectStage(value: string): value is ProjectStage {
  return PROJECT_STAGES.some((stage) => stage === value);
}

export function getProjectStage(status: ProjectStatus, stage: ProjectStage): ProjectStage {
  return status === "ARCHIVED" ? "ENDED" : stage;
}
