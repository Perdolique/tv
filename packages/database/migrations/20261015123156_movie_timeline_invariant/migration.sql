-- Keep old movie writers blocked until both reconciliation and the invariant are installed.
LOCK TABLE "catalog_viewings" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE FUNCTION "ensure_catalog_movie_timeline_event"() RETURNS trigger AS $$
BEGIN
  -- Defer the fallback so deployed API versions can insert their own event first.
  -- Re-read the viewing because it may have been deleted in the same transaction.
  INSERT INTO "catalog_timeline_events" ("user_id", "catalog_item_id", "kind", "occurred_at", "viewing_id")
  SELECT viewings."user_id", viewings."catalog_item_id", 'movie_viewing', viewings."recorded_at", viewings."id"
  FROM "catalog_viewings" viewings JOIN "catalog_items" items ON items."id" = viewings."catalog_item_id"
  WHERE viewings."id" = NEW."id" AND items."type" = 'movie'
    AND NOT EXISTS (SELECT 1 FROM "catalog_timeline_events" events WHERE events."viewing_id" = viewings."id" AND events."kind" = 'movie_viewing')
  ON CONFLICT ("viewing_id") WHERE "kind" = 'movie_viewing' DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "catalog_viewings_movie_timeline_event" AFTER INSERT ON "catalog_viewings"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ensure_catalog_movie_timeline_event"();
--> statement-breakpoint
INSERT INTO "catalog_timeline_events" ("user_id", "catalog_item_id", "kind", "occurred_at", "viewing_id")
SELECT viewings."user_id", viewings."catalog_item_id", 'movie_viewing', viewings."recorded_at", viewings."id"
FROM "catalog_viewings" viewings JOIN "catalog_items" items ON items."id" = viewings."catalog_item_id"
WHERE items."type" = 'movie'
  AND NOT EXISTS (SELECT 1 FROM "catalog_timeline_events" events WHERE events."viewing_id" = viewings."id" AND events."kind" = 'movie_viewing')
ON CONFLICT ("viewing_id") WHERE "kind" = 'movie_viewing' DO NOTHING;
