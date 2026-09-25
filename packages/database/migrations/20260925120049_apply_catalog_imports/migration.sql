CREATE TABLE "catalog_import_fields" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"catalog_item_id" uuid,
	"catalog_episode_id" uuid,
	"field_name" text NOT NULL,
	"locale" varchar(35) DEFAULT '' NOT NULL,
	"source" jsonb NOT NULL,
	"last_source_value" jsonb NOT NULL,
	"last_applied_value" jsonb NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "catalog_import_fields_target" CHECK (("catalog_item_id" IS NULL) <> ("catalog_episode_id" IS NULL)),
	CONSTRAINT "catalog_import_fields_name" CHECK (
      ("catalog_item_id" IS NOT NULL AND (
        ("field_name" IN ('title', 'description') AND "locale" <> '')
        OR ("field_name" IN ('releaseYear', 'posterPath') AND "locale" = '')
      ))
      OR ("catalog_episode_id" IS NOT NULL AND "field_name" IN ('seasonNumber', 'episodeNumber', 'sourceTitle', 'airDate') AND "locale" = '')
    )
);
--> statement-breakpoint
CREATE TABLE "catalog_import_operations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"preview_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"selection" jsonb NOT NULL,
	"title" text NOT NULL,
	"poster_id" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"failure_code" text,
	"failure_message" text,
	"retryable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalog_import_operations_status" CHECK ("status" IN ('pending', 'succeeded', 'failed')),
	CONSTRAINT "catalog_import_operations_lifecycle" CHECK (
    ("status" = 'pending' AND "lease_expires_at" IS NOT NULL AND "finished_at" IS NULL AND "result" IS NULL AND "failure_code" IS NULL AND "failure_message" IS NULL AND NOT "retryable")
    OR ("status" = 'succeeded' AND "lease_expires_at" IS NULL AND "finished_at" IS NOT NULL AND "result" IS NOT NULL AND "failure_code" IS NULL AND "failure_message" IS NULL AND NOT "retryable")
    OR ("status" = 'failed' AND "lease_expires_at" IS NULL AND "finished_at" IS NOT NULL AND "result" IS NULL AND "failure_code" IS NOT NULL AND "failure_message" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "catalog_item_descriptions" (
	"catalog_item_id" uuid,
	"locale" varchar(35),
	"description" text NOT NULL,
	CONSTRAINT "catalog_item_descriptions_pkey" PRIMARY KEY("catalog_item_id","locale")
);
--> statement-breakpoint
INSERT INTO "catalog_item_descriptions" ("catalog_item_id", "locale", "description")
SELECT "catalog_item_id", "locale", "description"
FROM "catalog_item_titles"
WHERE "description" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_item_titles" DROP COLUMN "description";--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_import_fields_item_unique" ON "catalog_import_fields" ("catalog_item_id","field_name","locale") WHERE "catalog_item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_import_fields_episode_unique" ON "catalog_import_fields" ("catalog_episode_id","field_name") WHERE "catalog_episode_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_import_operations_active_preview_unique" ON "catalog_import_operations" ("preview_id") WHERE "status" IN ('pending', 'succeeded');--> statement-breakpoint
CREATE INDEX "catalog_import_operations_started_at_index" ON "catalog_import_operations" ("started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_import_operations_operator_index" ON "catalog_import_operations" ("operator_id","started_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "catalog_import_fields" ADD CONSTRAINT "catalog_import_fields_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_import_fields" ADD CONSTRAINT "catalog_import_fields_FnkGKBjkHO3K_fkey" FOREIGN KEY ("catalog_episode_id") REFERENCES "catalog_episodes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_item_descriptions" ADD CONSTRAINT "catalog_item_descriptions_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;
