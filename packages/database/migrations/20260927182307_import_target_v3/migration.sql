-- Deploy with catalog imports stopped. Saved v2 previews are not converted.
UPDATE "catalog_import_operations"
SET "status" = 'failed', "lease_expires_at" = NULL, "finished_at" = now(),
    "failure_code" = 'preview_unavailable',
    "failure_message" = 'This preview is unavailable or has expired. Review the import again.',
    "retryable" = false
WHERE "status" = 'pending'
  AND "preview_id" IN (SELECT "id" FROM "catalog_import_previews");
--> statement-breakpoint
DELETE FROM "catalog_import_previews";
--> statement-breakpoint
ALTER TABLE "catalog_import_previews" DROP CONSTRAINT "catalog_import_previews_lifetime", ADD CONSTRAINT "catalog_import_previews_lifetime" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '24 hours');