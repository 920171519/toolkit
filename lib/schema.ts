import { DEFAULT_PROJECT_STAGE, PROJECT_STAGES } from "./project-stage";

export const SCHEMA_VERSION = 9;

export const PROJECT_STAGE_COLUMN_SQL =
  `stage TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_STAGE}' CHECK (stage IN (${PROJECT_STAGES.map((stage) => `'${stage}'`).join(",")}))`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  employee_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'MEMBER'
    CHECK (role IN ('ADMIN','SOFTWARE_MANAGER','INTEGRATION_TESTER','REVIEWER','PACKAGE_OWNER','TEST_VALIDATOR','MEMBER')),
  department TEXT NOT NULL DEFAULT '软件工程部',
  title TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_integration INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT 'amber',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS area_leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(area_id, user_id)
);

CREATE TABLE IF NOT EXISTS area_project_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(area_id, project_id)
);

CREATE TABLE IF NOT EXISTS notification_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  UNIQUE(user_id, notification_key)
);

CREATE TABLE IF NOT EXISTS area_project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(area_id, project_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  pm_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  software_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  ${PROJECT_STAGE_COLUMN_SQL},
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  binding_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  binding_approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  required_binding_count INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  trial_overdue_days INTEGER NOT NULL DEFAULT 7,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS package_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_id INTEGER NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  UNIQUE(package_id, node_id)
);

CREATE TABLE IF NOT EXISTS package_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  archive_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_TRANSFER'
    CHECK (status IN ('PENDING_TRANSFER','IN_TEST','PENDING_TRIAL','TRIAL','PENDING_FORMAL','FORMAL','VOID')),
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT NOT NULL,
  trial_form_no TEXT,
  trial_released_at TEXT,
  formal_released_at TEXT,
  form_flow_no TEXT,
  release_mode TEXT NOT NULL DEFAULT 'INTEGRATION',
  risk_conclusion TEXT,
  binding_mode TEXT NOT NULL DEFAULT 'PENDING',
  binding_reason TEXT,
  binding_decided_at TEXT,
  binding_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_kind TEXT,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  voided_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(package_id, version)
);

CREATE TABLE IF NOT EXISTS version_transfer_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_TEST','PASSED','FAILED','BLOCKED','TRIAL','PENDING_FORMAL','FORMAL','VOID','CANCELLED')),
  integration_status TEXT CHECK (integration_status IN ('PENDING','IN_TEST','PASSED','FAILED','BLOCKED')),
  trial_form_no TEXT,
  trial_released_at TEXT,
  trial_released_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  formal_released_at TEXT,
  formal_released_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  form_flow_no TEXT,
  void_reason TEXT,
  voided_at TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(package_version_id, project_id)
);

CREATE TABLE IF NOT EXISTS report_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_node_approvers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES project_nodes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(node_id, user_id)
);

CREATE TABLE IF NOT EXISTS integration_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','IN_TEST','COMPLETED','TERMINATED')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  completed_at TEXT,
  conclusion TEXT CHECK (conclusion IN ('PASS','FAIL','BLOCKED')),
  issue_attribution TEXT CHECK (issue_attribution IN ('NONE','PACKAGE_RELATED','NOT_PACKAGE_RELATED','UNKNOWN')),
  test_summary TEXT,
  test_report_url TEXT,
  test_report_file_id INTEGER REFERENCES report_files(id) ON DELETE SET NULL,
  test_report_name TEXT,
  terminated_at TEXT,
  terminate_reason TEXT
);


CREATE TABLE IF NOT EXISTS trial_risk_admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES version_transfer_requests(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  project_name TEXT NOT NULL,
  batch_id INTEGER REFERENCES integration_batches(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('PENDING','IN_TEST','FAILED','BLOCKED','PASSED_NO_EVIDENCE')),
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  invalidated_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS trial_risk_admissions_current
  ON trial_risk_admissions(package_version_id) WHERE invalidated_at IS NULL;

CREATE TABLE IF NOT EXISTS batch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES integration_batches(id) ON DELETE CASCADE,
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,
  archive_url TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  is_changed INTEGER NOT NULL DEFAULT 0,
  transfer_request_id INTEGER REFERENCES version_transfer_requests(id) ON DELETE SET NULL,
  formal_version TEXT,
  trial_versions TEXT,
  previous_test_version TEXT,
  changed_vs_previous INTEGER NOT NULL DEFAULT 0,
  issue_affected INTEGER NOT NULL DEFAULT 0 CHECK (issue_affected IN (0,1)),
  UNIQUE(batch_id, package_id)
);

CREATE TABLE IF NOT EXISTS risk_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES integration_batches(id) ON DELETE CASCADE,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  conclusion TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS formal_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  conclusion TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS binding_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  node_id INTEGER NOT NULL REFERENCES project_nodes(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PASSED','FAILED')),
  note TEXT NOT NULL DEFAULT '',
  validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  validated_at TEXT,
  UNIQUE(package_version_id, project_id, node_id)
);

CREATE TABLE IF NOT EXISTS binding_flow_barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id INTEGER NOT NULL REFERENCES binding_flows(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS binding_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES version_transfer_requests(id) ON DELETE CASCADE,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  node_id INTEGER NOT NULL REFERENCES project_nodes(id) ON DELETE RESTRICT,
  required_count INTEGER NOT NULL DEFAULT 1,
  binding_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PASSED','CANCELLED')),
  pushed_at TEXT,
  pushed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision_reason TEXT,
  waived_at TEXT,
  waived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(package_version_id, project_id, node_id)
);

CREATE TABLE IF NOT EXISTS binding_requirement_approvers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id INTEGER NOT NULL REFERENCES binding_requirements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(requirement_id, user_id)
);

CREATE TABLE IF NOT EXISTS binding_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_no TEXT NOT NULL UNIQUE,
  requirement_id INTEGER NOT NULL REFERENCES binding_requirements(id) ON DELETE CASCADE,
  package_version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  node_id INTEGER NOT NULL REFERENCES project_nodes(id) ON DELETE RESTRICT,
  device_barcode TEXT NOT NULL,
  web_url TEXT,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_comment TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT
);

CREATE TABLE IF NOT EXISTS batch_progress_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES integration_batches(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_area_project_leads_area ON area_project_leads(area_id, project_id);
CREATE INDEX IF NOT EXISTS idx_area_project_leads_user ON area_project_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_package ON package_versions(package_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_versions_status ON package_versions(status);
CREATE INDEX IF NOT EXISTS idx_requests_version ON version_transfer_requests(package_version_id);
CREATE INDEX IF NOT EXISTS idx_requests_project_status ON version_transfer_requests(project_id, status);
CREATE INDEX IF NOT EXISTS idx_batches_project ON integration_batches(project_id, status);
CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_binding_requirements_version ON binding_requirements(package_version_id);
CREATE INDEX IF NOT EXISTS idx_area_leaders_area ON area_leaders(area_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_node_approvers_node ON project_node_approvers(node_id);
CREATE INDEX IF NOT EXISTS idx_requirement_approvers_req ON binding_requirement_approvers(requirement_id);
CREATE INDEX IF NOT EXISTS idx_progress_notes_batch ON batch_progress_notes(batch_id);
CREATE INDEX IF NOT EXISTS idx_area_project_members ON area_project_members(area_id, project_id);
CREATE INDEX IF NOT EXISTS idx_binding_requirements_request ON binding_requirements(request_id);
CREATE INDEX IF NOT EXISTS idx_binding_flow_barcodes_flow ON binding_flow_barcodes(flow_id);
CREATE INDEX IF NOT EXISTS idx_binding_flows_approver ON binding_flows(approver_id, status);
CREATE INDEX IF NOT EXISTS idx_binding_flows_submitter ON binding_flows(submitted_by, status);
CREATE INDEX IF NOT EXISTS idx_usages_package ON package_usages(package_id);
CREATE INDEX IF NOT EXISTS idx_usages_project ON package_usages(project_id, node_id);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(software_manager_id);

CREATE TABLE IF NOT EXISTS project_pms (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_software_managers (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_pms_user ON project_pms(user_id);
CREATE INDEX IF NOT EXISTS idx_project_managers_user ON project_software_managers(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_submitter ON package_versions(submitted_by);
CREATE INDEX IF NOT EXISTS idx_requirements_owner ON binding_requirements(binding_owner_id, status);
CREATE INDEX IF NOT EXISTS idx_binding_version ON binding_tasks(package_version_id);
CREATE INDEX IF NOT EXISTS idx_risk_version ON risk_reviews(package_version_id);
CREATE INDEX IF NOT EXISTS idx_formal_version ON formal_reviews(package_version_id);
`;
