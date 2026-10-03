CREATE TABLE "catalog_item_ratings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"score" integer NOT NULL,
	CONSTRAINT "catalog_item_ratings_score_bounds" CHECK ("score" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_item_ratings_user_item_unique" ON "catalog_item_ratings" ("user_id","catalog_item_id");--> statement-breakpoint
CREATE INDEX "catalog_item_ratings_item_index" ON "catalog_item_ratings" ("catalog_item_id");--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;