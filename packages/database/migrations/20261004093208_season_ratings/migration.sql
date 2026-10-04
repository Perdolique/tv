DROP INDEX "catalog_item_ratings_user_item_unique";--> statement-breakpoint
DROP INDEX "catalog_item_ratings_item_index";--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD COLUMN "season_number" integer;--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_user_target_unique" UNIQUE NULLS NOT DISTINCT("user_id","catalog_item_id","season_number");--> statement-breakpoint
CREATE INDEX "catalog_item_ratings_target_index" ON "catalog_item_ratings" ("catalog_item_id","season_number");--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ADD CONSTRAINT "catalog_item_ratings_season_number_positive" CHECK ("season_number" > 0);