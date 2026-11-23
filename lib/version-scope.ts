export const LEGACY_VERSION_IMPORT_SQL = `
  EXISTS (
    SELECT 1 FROM audit_logs log
    WHERE log.entity_type = 'PACKAGE_VERSION' AND log.entity_id = pv.id AND log.action = 'IMPORT_LEGACY_VERSION'
  )
`;

export const STANDALONE_IMPORTED_VERSION_SQL = `
  (${LEGACY_VERSION_IMPORT_SQL}
    AND NOT EXISTS (SELECT 1 FROM version_transfer_requests r WHERE r.package_version_id = pv.id)
    AND NOT EXISTS (SELECT 1 FROM binding_requirements b WHERE b.package_version_id = pv.id)
    AND NOT EXISTS (SELECT 1 FROM binding_tasks b WHERE b.package_version_id = pv.id))
`;

// Imported releases are package records. A later batch can test one without
// changing its historical scope. Older standalone releases have no audit marker.
const STANDALONE_RELEASE_PROJECT_SCOPE_SQL = `
  EXISTS (
    SELECT 1 FROM package_usages usage WHERE usage.package_id = pv.package_id AND usage.project_id = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM version_transfer_requests req WHERE req.package_version_id = pv.id
  )
  AND (
    ${LEGACY_VERSION_IMPORT_SQL}
    OR (
      NOT EXISTS (SELECT 1 FROM batch_items item WHERE item.package_version_id = pv.id)
      AND NOT EXISTS (SELECT 1 FROM binding_requirements requirement WHERE requirement.package_version_id = pv.id)
      AND NOT EXISTS (SELECT 1 FROM binding_tasks task WHERE task.package_version_id = pv.id)
    )
  )
`;

export const STANDALONE_VERSION_IN_PROJECT_SQL = `
  pv.status IN ('FORMAL', 'TRIAL')
  AND ${STANDALONE_RELEASE_PROJECT_SCOPE_SQL}
`;

export const STANDALONE_VERSION_HISTORY_IN_PROJECT_SQL = `
  (pv.status IN ('FORMAL', 'TRIAL')
    OR (pv.status = 'VOID' AND (pv.trial_released_at IS NOT NULL OR pv.formal_released_at IS NOT NULL)))
  AND ${STANDALONE_RELEASE_PROJECT_SCOPE_SQL}
`;
