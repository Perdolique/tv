CREATE TABLE "catalog_releases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"catalog_item_id" uuid NOT NULL,
	"release_date" date NOT NULL,
	"season_number" integer,
	"episode_number" integer
);
--> statement-breakpoint
CREATE INDEX "catalog_releases_catalog_item_id_release_date_index" ON "catalog_releases" ("catalog_item_id","release_date");--> statement-breakpoint
ALTER TABLE "catalog_releases" ADD CONSTRAINT "catalog_releases_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;