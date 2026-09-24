CREATE TABLE "catalog_import_previews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"operator_id" uuid NOT NULL,
	"status" text NOT NULL,
	"selection" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"catalog_fingerprint" text NOT NULL,
	"poster_bytes" bytea,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "catalog_import_previews_status" CHECK ("status" IN ('ready', 'blocked')),
	CONSTRAINT "catalog_import_previews_fingerprint" CHECK ("catalog_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "catalog_import_previews_lifetime" CHECK ("expires_at" = "created_at" + interval '24 hours'),
	CONSTRAINT "catalog_import_previews_poster_size" CHECK (octet_length("poster_bytes") BETWEEN 1 AND 1048576),
	CONSTRAINT "catalog_import_previews_poster_pair" CHECK (("poster_bytes" IS NULL) = ("data"->>'poster' IS NULL))
);
--> statement-breakpoint
CREATE INDEX "catalog_import_previews_expires_at_index" ON "catalog_import_previews" ("expires_at");--> statement-breakpoint
ALTER TABLE "catalog_import_previews" ADD CONSTRAINT "catalog_import_previews_operator_id_users_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE CASCADE;