-- The agreed test diary is reset as one atomic schema transition. Catalog and account data stay intact.
TRUNCATE TABLE "catalog_timeline_event_watches", "catalog_timeline_events", "catalog_viewing_episode_watches", "catalog_item_ratings", "catalog_viewing_contexts", "catalog_viewing_creations", "catalog_series_requests", "catalog_viewings";
--> statement-breakpoint
DROP TRIGGER "catalog_viewings_movie_watched_date" ON "catalog_viewings";
--> statement-breakpoint
DROP FUNCTION "ensure_catalog_movie_watched_date"();
--> statement-breakpoint
DROP TRIGGER "catalog_viewings_movie_timeline_event" ON "catalog_viewings";
--> statement-breakpoint
DROP FUNCTION "ensure_catalog_movie_timeline_event"();
--> statement-breakpoint
CREATE TABLE "catalog_rating_votes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"season_number" integer,
	"catalog_episode_id" uuid,
	"source_viewing_id" uuid NOT NULL,
	"score" integer NOT NULL,
	CONSTRAINT "catalog_rating_votes_user_target_unique" UNIQUE NULLS NOT DISTINCT("user_id","catalog_item_id","season_number","catalog_episode_id"),
	CONSTRAINT "catalog_rating_votes_single_target" CHECK ("catalog_episode_id" IS NULL OR "season_number" IS NULL),
	CONSTRAINT "catalog_rating_votes_season_positive" CHECK ("season_number" > 0),
	CONSTRAINT "catalog_rating_votes_score_bounds" CHECK ("score" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "catalog_viewing_requests" (
	"user_id" uuid,
	"request_id" uuid,
	"catalog_item_id" uuid NOT NULL,
	"action" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"viewing_id" uuid,
	"watch_ids" jsonb NOT NULL,
	"tombstoned" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalog_viewing_requests_pkey" PRIMARY KEY("user_id","request_id")
);
--> statement-breakpoint
DROP VIEW "catalog_episode_watches";--> statement-breakpoint
DROP VIEW "catalog_movie_watches";--> statement-breakpoint
DROP TABLE "catalog_series_requests";--> statement-breakpoint
DROP TABLE "catalog_viewing_creations";--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" DROP CONSTRAINT "catalog_timeline_events_score";--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" DROP COLUMN "previous_score";--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" DROP COLUMN "score";--> statement-breakpoint
ALTER TABLE "catalog_item_ratings" ALTER COLUMN "viewing_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "catalog_rating_votes_source_index" ON "catalog_rating_votes" ("source_viewing_id");--> statement-breakpoint
CREATE INDEX "catalog_rating_votes_target_index" ON "catalog_rating_votes" ("catalog_item_id","season_number");--> statement-breakpoint
CREATE INDEX "catalog_rating_votes_episode_index" ON "catalog_rating_votes" ("catalog_episode_id");--> statement-breakpoint
CREATE INDEX "catalog_viewing_requests_viewing_index" ON "catalog_viewing_requests" ("viewing_id");--> statement-breakpoint
ALTER TABLE "catalog_rating_votes" ADD CONSTRAINT "catalog_rating_votes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_rating_votes" ADD CONSTRAINT "catalog_rating_votes_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_rating_votes" ADD CONSTRAINT "catalog_rating_votes_episode_item_fk" FOREIGN KEY ("catalog_episode_id","catalog_item_id") REFERENCES "catalog_episodes"("id","catalog_item_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_rating_votes" ADD CONSTRAINT "catalog_rating_votes_source_owner_item_fk" FOREIGN KEY ("user_id","catalog_item_id","source_viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_requests" ADD CONSTRAINT "catalog_viewing_requests_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_requests" ADD CONSTRAINT "catalog_viewing_requests_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_requests" ADD CONSTRAINT "catalog_viewing_requests_viewing_fk" FOREIGN KEY ("user_id","catalog_item_id","viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE SET NULL ("viewing_id");--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" DROP CONSTRAINT "catalog_timeline_events_kind", ADD CONSTRAINT "catalog_timeline_events_kind" CHECK ("kind" IN ('movie_viewing', 'episode_watched', 'series_started', 'rewatch_started', 'series_completed', 'season_completed', 'available_completed'));--> statement-breakpoint
ALTER TABLE "catalog_viewings" DROP CONSTRAINT "catalog_viewings_status", ADD CONSTRAINT "catalog_viewings_status" CHECK ("status" IN ('watching', 'completed'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_catalog_viewing_item_type"() RETURNS trigger AS $$
DECLARE item_type catalog_item_type;
BEGIN
  SELECT "type" INTO item_type FROM "catalog_items" WHERE "id" = NEW."catalog_item_id" FOR NO KEY UPDATE;
  IF item_type IS NULL OR (item_type = 'movie' AND (NEW."status" <> 'completed' OR NEW."completed_on" IS NULL)) THEN
    RAISE EXCEPTION 'Movie viewings require a completion date and completed status' USING ERRCODE = '23514';
  END IF;
  IF item_type = 'series' AND (NEW."started_on" IS NULL OR (NEW."status" = 'completed' AND NEW."completed_on" IS NULL) OR (NEW."status" = 'watching' AND NEW."completed_on" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Series viewings require dates matching their status' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER "catalog_viewings_item_status" ON "catalog_viewings";
--> statement-breakpoint
CREATE TRIGGER "catalog_viewings_item_status" BEFORE INSERT OR UPDATE OF "catalog_item_id", "status", "started_on", "completed_on" ON "catalog_viewings"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_viewing_item_type"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "remove_catalog_watch_dependencies"() RETURNS trigger AS $$
BEGIN
  UPDATE "catalog_viewing_requests" SET "tombstoned" = true WHERE "user_id" = OLD."user_id" AND "watch_ids" @> jsonb_build_array(OLD."id"::text)
    AND EXISTS (SELECT 1 FROM "catalog_viewings" WHERE "id" = "catalog_viewing_requests"."viewing_id")
    AND EXISTS (SELECT 1 FROM "users" WHERE "id" = OLD."user_id")
    AND EXISTS (SELECT 1 FROM "catalog_items" WHERE "id" = OLD."catalog_item_id");
  DELETE FROM "catalog_timeline_events" WHERE "id" IN (SELECT "event_id" FROM "catalog_timeline_event_watches" WHERE "watch_id" = OLD."id");
  DELETE FROM "catalog_rating_votes" WHERE "source_viewing_id" = OLD."viewing_id" AND "catalog_episode_id" = OLD."catalog_episode_id";
  DELETE FROM "catalog_item_ratings" WHERE "viewing_id" = OLD."viewing_id" AND "catalog_episode_id" = OLD."catalog_episode_id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER "catalog_viewings_tombstone_requests" ON "catalog_viewings";
--> statement-breakpoint
DROP FUNCTION "tombstone_catalog_series_requests"();
--> statement-breakpoint
CREATE FUNCTION "tombstone_catalog_viewing_requests"() RETURNS trigger AS $$
BEGIN
  UPDATE "catalog_viewing_requests" SET "tombstoned" = true WHERE "viewing_id" = OLD."id"
    AND EXISTS (SELECT 1 FROM "users" WHERE "id" = OLD."user_id")
    AND EXISTS (SELECT 1 FROM "catalog_items" WHERE "id" = OLD."catalog_item_id");
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER "catalog_viewings_tombstone_requests" BEFORE DELETE ON "catalog_viewings"
FOR EACH ROW EXECUTE FUNCTION "tombstone_catalog_viewing_requests"();
