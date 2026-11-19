// Imported releases are package records. A later batch can test one without
// changing its historical scope. Older standalone releases have no audit marker.
export const STANDALONE_VERSION_IN_PROJECT_SQL = `
  pv.status IN ('FORMAL', 'TRIAL')
  AND EXISTS (
    SELECT 1 FROM package_usages usage WHERE usage.package_id = pv.package_id AND usage.project_id = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM version_transfer_requests req WHERE req.package_version_id = pv.id
  )
  AND (
    EXISTS (
      SELECT 1 FROM audit_logs log
      WHERE log.entity_type = 'PACKAGE_VERSION' AND log.entity_id = pv.id AND log.action = 'IMPORT_LEGACY_VERSION'
    )
    OR (
      NOT EXISTS (SELECT 1 FROM batch_items item WHERE item.package_version_id = pv.id)
      AND NOT EXISTS (SELECT 1 FROM binding_requirements requirement WHERE requirement.package_version_id = pv.id)
      AND NOT EXISTS (SELECT 1 FROM binding_tasks task WHERE task.package_version_id = pv.id)
    )
  )
`;
