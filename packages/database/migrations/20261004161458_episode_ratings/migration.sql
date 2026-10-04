ALTER TABLE "catalog_item_ratings" ADD COLUMN "catalog_episode_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_episodes" ADD CONSTRAINT "catalog_episodes_id_item_unique" UNIQUE("id","catalog_item_id");--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" DROP CONSTRAINT "catalog_item_ratings_user_target_unique";--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_user_target_unique" UNIQUE NULLS NOT DISTINCT("user_id","catalog_item_id","season_number","catalog_episode_id");--> statement-breakpoint
CREATE INDEX "catalog_item_ratings_episode_index" ON "catalog_item_ratings" ("catalog_episode_id");--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_episode_item_fk" FOREIGN KEY ("catalog_episode_id","catalog_item_id") REFERENCES "catalog_episodes"("id","catalog_item_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_single_target" CHECK ("catalog_episode_id" IS NULL OR "season_number" IS NULL);