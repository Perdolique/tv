UPDATE "catalog_import_operations"
SET "status" = 'failed', "lease_expires_at" = NULL, "finished_at" = now(),
    "failure_code" = 'preview_unavailable',
    "failure_message" = 'This preview is unavailable or has expired. Review the import again.',
    "retryable" = false
WHERE "status" = 'pending'
  AND "preview_id" IN (
    SELECT "id" FROM "catalog_import_previews" WHERE "data"->>'version' IS DISTINCT FROM '3'
  );
--> statement-breakpoint
DELETE FROM "catalog_import_previews" WHERE "data"->>'version' IS DISTINCT FROM '3';
--> statement-breakpoint
ALTER TABLE "catalog_import_previews" ADD CONSTRAINT "catalog_import_previews_version" CHECK (("data"->>'version') IS NOT DISTINCT FROM '3');
