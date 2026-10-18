ALTER TABLE "catalog_item_ratings" ADD COLUMN "viewing_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" DROP CONSTRAINT "catalog_item_ratings_user_target_unique";--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_user_target_unique" UNIQUE NULLS NOT DISTINCT("user_id","catalog_item_id","season_number","catalog_episode_id","viewing_id");--> statement-breakpoint
CREATE INDEX "catalog_item_ratings_viewing_index" ON "catalog_item_ratings" ("viewing_id");--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_viewing_owner_item_fk" FOREIGN KEY ("user_id","catalog_item_id","viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE CASCADE;