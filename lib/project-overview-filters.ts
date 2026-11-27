import { columnFilterKeys, type ColumnFilterField } from "./column-filters";

export const projectOverviewFields = {
  project: [
    { key: "name", label: "项目名称", kind: "text" },
    { key: "code", label: "项目编码", kind: "text" },
  ],
  stage: { key: "stage", label: "产品阶段", kind: "choices" },
  pm: { key: "pm", label: "PM", kind: "choices" },
  manager: { key: "manager", label: "软件经理", kind: "choices" },
} satisfies {
  project: ColumnFilterField[];
  stage: ColumnFilterField;
  pm: ColumnFilterField;
  manager: ColumnFilterField;
};

export const projectOverviewReturnKeys = [
  "q", "stage", "page", "pageSize",
  ...Object.values(projectOverviewFields).flat().flatMap(columnFilterKeys),
];
