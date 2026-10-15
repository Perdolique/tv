CREATE TABLE "catalog_series_requests" (
	"user_id" uuid,
	"request_id" uuid,
	"catalog_item_id" uuid NOT NULL,
	"action" text NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"viewing_id" uuid,
	"watch_ids" jsonb NOT NULL,
	"tombstoned" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalog_series_requests_pkey" PRIMARY KEY("user_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_timeline_event_watches" (
	"event_id" uuid,
	"watch_id" uuid,
	CONSTRAINT "catalog_timeline_event_watches_pkey" PRIMARY KEY("event_id","watch_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"viewing_id" uuid,
	"watch_id" uuid,
	"catalog_episode_id" uuid,
	"season_number" integer,
	"previous_score" integer,
	"score" integer,
	"episode_ids" jsonb,
	CONSTRAINT "catalog_timeline_events_kind" CHECK ("kind" IN ('movie_viewing', 'episode_watched', 'series_started', 'rewatch_started', 'series_paused', 'series_completed', 'season_completed', 'available_completed', 'rating_changed')),
	CONSTRAINT "catalog_timeline_events_score" CHECK (("previous_score" IS NULL OR "previous_score" BETWEEN 1 AND 10) AND ("score" IS NULL OR "score" BETWEEN 1 AND 10))
);
--> statement-breakpoint
CREATE TABLE "catalog_viewing_episode_watches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"viewing_id" uuid NOT NULL,
	"catalog_episode_id" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "catalog_viewing_episode_watches_viewing_episode_unique" UNIQUE("viewing_id","catalog_episode_id"),
	CONSTRAINT "catalog_viewing_episode_watches_owner_item_id_unique" UNIQUE("user_id","catalog_item_id","id")
);
--> statement-breakpoint
DROP VIEW "catalog_movie_watches";--> statement-breakpoint
LOCK TABLE "catalog_episode_watches" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE "catalog_episode_watches" RENAME TO "catalog_episode_watches_legacy";--> statement-breakpoint
ALTER TABLE "catalog_viewings" DROP CONSTRAINT "catalog_viewings_completed_only";--> statement-breakpoint
CREATE INDEX "catalog_series_requests_viewing_index" ON "catalog_series_requests" ("viewing_id");--> statement-breakpoint
CREATE INDEX "catalog_timeline_event_watches_watch_index" ON "catalog_timeline_event_watches" ("watch_id");--> statement-breakpoint
CREATE INDEX "catalog_timeline_events_owner_item_time_index" ON "catalog_timeline_events" ("user_id","catalog_item_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_timeline_events_watch_index" ON "catalog_timeline_events" ("watch_id");--> statement-breakpoint
CREATE INDEX "catalog_timeline_events_viewing_index" ON "catalog_timeline_events" ("viewing_id");--> statement-breakpoint
CREATE INDEX "catalog_viewing_episode_watches_episode_index" ON "catalog_viewing_episode_watches" ("catalog_episode_id");--> statement-breakpoint
CREATE INDEX "catalog_viewing_episode_watches_user_marked_index" ON "catalog_viewing_episode_watches" ("user_id","marked_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_viewings_one_watching_unique" ON "catalog_viewings" ("user_id","catalog_item_id") WHERE "status" = 'watching';--> statement-breakpoint
ALTER TABLE "catalog_series_requests" ADD CONSTRAINT "catalog_series_requests_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_series_requests" ADD CONSTRAINT "catalog_series_requests_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_series_requests" ADD CONSTRAINT "catalog_series_requests_viewing_fk" FOREIGN KEY ("user_id","catalog_item_id","viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE SET NULL ("viewing_id");--> statement-breakpoint
ALTER TABLE "catalog_timeline_event_watches" ADD CONSTRAINT "catalog_timeline_event_watches_o9jPOtXtABYT_fkey" FOREIGN KEY ("event_id") REFERENCES "catalog_timeline_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_timeline_event_watches" ADD CONSTRAINT "catalog_timeline_event_watches_8FcDpDlPramA_fkey" FOREIGN KEY ("watch_id") REFERENCES "catalog_viewing_episode_watches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" ADD CONSTRAINT "catalog_timeline_events_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" ADD CONSTRAINT "catalog_timeline_events_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" ADD CONSTRAINT "catalog_timeline_events_viewing_fk" FOREIGN KEY ("user_id","catalog_item_id","viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" ADD CONSTRAINT "catalog_timeline_events_watch_fk" FOREIGN KEY ("user_id","catalog_item_id","watch_id") REFERENCES "catalog_viewing_episode_watches"("user_id","catalog_item_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_timeline_events" ADD CONSTRAINT "catalog_timeline_events_episode_fk" FOREIGN KEY ("catalog_episode_id","catalog_item_id") REFERENCES "catalog_episodes"("id","catalog_item_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_episode_watches" ADD CONSTRAINT "catalog_viewing_episode_watches_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_episode_watches" ADD CONSTRAINT "catalog_viewing_episode_watches_pWarECentRZs_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_episode_watches" ADD CONSTRAINT "catalog_viewing_episode_watches_viewing_fk" FOREIGN KEY ("user_id","catalog_item_id","viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_episode_watches" ADD CONSTRAINT "catalog_viewing_episode_watches_episode_fk" FOREIGN KEY ("catalog_episode_id","catalog_item_id") REFERENCES "catalog_episodes"("id","catalog_item_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewings" ADD CONSTRAINT "catalog_viewings_status" CHECK ("status" IN ('watching', 'paused', 'completed'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_catalog_viewing_item_type"() RETURNS trigger AS $$
DECLARE item_type catalog_item_type;
BEGIN
  SELECT "type" INTO item_type FROM "catalog_items" WHERE "id" = NEW."catalog_item_id" FOR NO KEY UPDATE;
  IF item_type IS NULL OR (item_type = 'movie' AND NEW."status" <> 'completed') THEN
    RAISE EXCEPTION 'movie viewings must be completed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER "catalog_viewings_movie_only" ON "catalog_viewings";
--> statement-breakpoint
CREATE TRIGGER "catalog_viewings_item_status" BEFORE INSERT OR UPDATE OF "catalog_item_id", "status" ON "catalog_viewings"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_viewing_item_type"();
--> statement-breakpoint
INSERT INTO "catalog_viewings" ("user_id", "catalog_item_id", "status", "recorded_at")
SELECT watches."user_id", episodes."catalog_item_id", 'watching', min(watches."marked_at")
FROM "catalog_episode_watches_legacy" watches JOIN "catalog_episodes" episodes ON episodes."id" = watches."catalog_episode_id"
GROUP BY watches."user_id", episodes."catalog_item_id";
--> statement-breakpoint
INSERT INTO "catalog_viewing_contexts" ("user_id", "catalog_item_id", "current_viewing_id", "context_version")
SELECT "user_id", "catalog_item_id", "id", 1 FROM "catalog_viewings" WHERE "status" = 'watching';
--> statement-breakpoint
INSERT INTO "catalog_viewing_episode_watches" ("user_id", "catalog_item_id", "viewing_id", "catalog_episode_id", "marked_at")
SELECT watches."user_id", episodes."catalog_item_id", viewings."id", watches."catalog_episode_id", watches."marked_at"
FROM "catalog_episode_watches_legacy" watches JOIN "catalog_episodes" episodes ON episodes."id" = watches."catalog_episode_id"
JOIN "catalog_viewings" viewings ON viewings."user_id" = watches."user_id" AND viewings."catalog_item_id" = episodes."catalog_item_id" AND viewings."status" = 'watching';
--> statement-breakpoint
INSERT INTO "catalog_timeline_events" ("user_id", "catalog_item_id", "kind", "occurred_at", "viewing_id")
SELECT viewings."user_id", viewings."catalog_item_id", 'movie_viewing', viewings."recorded_at", viewings."id"
FROM "catalog_viewings" viewings JOIN "catalog_items" items ON items."id" = viewings."catalog_item_id" WHERE items."type" = 'movie';
--> statement-breakpoint
INSERT INTO "catalog_timeline_events" ("user_id", "catalog_item_id", "kind", "occurred_at", "viewing_id", "watch_id", "catalog_episode_id")
SELECT "user_id", "catalog_item_id", 'episode_watched', "marked_at", "viewing_id", "id", "catalog_episode_id" FROM "catalog_viewing_episode_watches";
--> statement-breakpoint
DROP TABLE "catalog_episode_watches_legacy";
--> statement-breakpoint
CREATE FUNCTION "enforce_catalog_viewing_episode_watch_type"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "catalog_items" WHERE "id" = NEW."catalog_item_id" AND "type" = 'series' FOR NO KEY UPDATE) THEN
    RAISE EXCEPTION 'episode watches require a series viewing' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "catalog_viewing_episode_watches_series_only" BEFORE INSERT OR UPDATE OF "catalog_item_id" ON "catalog_viewing_episode_watches"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_viewing_episode_watch_type"();
--> statement-breakpoint
CREATE FUNCTION "remove_catalog_watch_dependencies"() RETURNS trigger AS $$
BEGIN
  UPDATE "catalog_series_requests" SET "tombstoned" = true WHERE "user_id" = OLD."user_id" AND "watch_ids" @> jsonb_build_array(OLD."id"::text);
  DELETE FROM "catalog_timeline_events" WHERE "id" IN (SELECT "event_id" FROM "catalog_timeline_event_watches" WHERE "watch_id" = OLD."id");
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "catalog_viewing_episode_watches_remove_dependencies" BEFORE DELETE ON "catalog_viewing_episode_watches"
FOR EACH ROW EXECUTE FUNCTION "remove_catalog_watch_dependencies"();
--> statement-breakpoint
CREATE FUNCTION "tombstone_catalog_series_requests"() RETURNS trigger AS $$
BEGIN
  UPDATE "catalog_series_requests" SET "tombstoned" = true WHERE "viewing_id" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "catalog_viewings_tombstone_requests" BEFORE DELETE ON "catalog_viewings"
FOR EACH ROW EXECUTE FUNCTION "tombstone_catalog_series_requests"();
--> statement-breakpoint
CREATE FUNCTION "enforce_catalog_timeline_watch_dependency"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "catalog_timeline_events" events JOIN "catalog_viewing_episode_watches" watches
    ON watches."user_id" = events."user_id" AND watches."catalog_item_id" = events."catalog_item_id" AND watches."viewing_id" = events."viewing_id"
    WHERE events."id" = NEW."event_id" AND watches."id" = NEW."watch_id"
  ) THEN
    RAISE EXCEPTION 'timeline dependencies require a watch from the same viewing' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "catalog_timeline_event_watches_owner" BEFORE INSERT OR UPDATE ON "catalog_timeline_event_watches"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_timeline_watch_dependency"();
--> statement-breakpoint
CREATE VIEW "catalog_episode_watches" AS (SELECT watches.user_id, watches.catalog_episode_id, watches.marked_at FROM catalog_viewing_episode_watches watches JOIN catalog_viewing_contexts contexts ON contexts.user_id = watches.user_id AND contexts.catalog_item_id = watches.catalog_item_id AND contexts.current_viewing_id = watches.viewing_id);--> statement-breakpoint
CREATE VIEW "catalog_movie_watches" AS (SELECT viewings.user_id, viewings.catalog_item_id, max(viewings.recorded_at) AS marked_at FROM catalog_viewings viewings JOIN catalog_items items ON items.id = viewings.catalog_item_id WHERE items.type = 'movie' AND viewings.status = 'completed' GROUP BY viewings.user_id, viewings.catalog_item_id);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_timeline_events_episode_watch_unique" ON "catalog_timeline_events" ("watch_id") WHERE "kind" = 'episode_watched';--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_timeline_events_movie_viewing_unique" ON "catalog_timeline_events" ("viewing_id") WHERE "kind" = 'movie_viewing';