CREATE TABLE "catalog_collection_items" (
	"collection_id" uuid,
	"catalog_item_id" uuid,
	"position" integer NOT NULL,
	CONSTRAINT "catalog_collection_items_pkey" PRIMARY KEY("collection_id","catalog_item_id"),
	CONSTRAINT "catalog_collection_items_position_unique" UNIQUE("collection_id","position"),
	CONSTRAINT "catalog_collection_items_position" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_collections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"title" text NOT NULL,
	"description" text,
	"is_featured" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalog_collections_title" CHECK (length(btrim("title")) BETWEEN 1 AND 160),
	CONSTRAINT "catalog_collections_description" CHECK (length("description") <= 2000),
	CONSTRAINT "catalog_collections_revision" CHECK ("revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "added_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "catalog_items" AS item SET "added_at" = source."added_at"
FROM (
  SELECT "result"->>'catalogItemId' AS "catalog_item_id", min("finished_at") AS "added_at"
  FROM "catalog_import_operations"
  WHERE "status" = 'succeeded' AND "result"->>'createdItem' = 'true'
  GROUP BY "result"->>'catalogItemId'
) AS source
WHERE item."id"::text = source."catalog_item_id";
--> statement-breakpoint
ALTER TABLE "catalog_items" ALTER COLUMN "added_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "catalog_collection_items_title_index" ON "catalog_collection_items" ("catalog_item_id","collection_id");--> statement-breakpoint
CREATE INDEX "catalog_collections_title_index" ON "catalog_collections" ("title","id");--> statement-breakpoint
CREATE INDEX "catalog_items_added_index" ON "catalog_items" ("added_at" DESC NULLS LAST,"id");--> statement-breakpoint
ALTER TABLE "catalog_collection_items" ADD CONSTRAINT "catalog_collection_items_vkjZo7ahniSs_fkey" FOREIGN KEY ("collection_id") REFERENCES "catalog_collections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_collection_items" ADD CONSTRAINT "catalog_collection_items_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;