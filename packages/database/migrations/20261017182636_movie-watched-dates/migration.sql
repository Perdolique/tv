-- Block old writers until the backfill and required-date invariant are installed together.
LOCK TABLE "catalog_viewings" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
-- Old movie dates have no saved viewer time zone. Use the recording day in UTC only when no viewing date exists.
UPDATE "catalog_viewings" AS viewings
SET "completed_on" = coalesce(viewings.completed_on, viewings.started_on, (viewings.recorded_at AT TIME ZONE 'UTC')::date)
FROM "catalog_items" AS items
WHERE items.id = viewings.catalog_item_id AND items.type = 'movie' AND viewings.completed_on IS NULL;
--> statement-breakpoint
CREATE INDEX "catalog_viewings_owner_item_watched_index" ON "catalog_viewings" ("user_id","catalog_item_id","completed_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_viewings_owner_watched_index" ON "catalog_viewings" ("user_id","completed_on" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE FUNCTION "ensure_catalog_movie_watched_date"() RETURNS trigger AS $$
BEGIN
  IF NEW."completed_on" IS NULL AND EXISTS (SELECT 1 FROM "catalog_items" WHERE "id" = NEW."catalog_item_id" AND "type" = 'movie') THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Movie viewing date is required' USING ERRCODE = '23514', CONSTRAINT = 'catalog_viewings_movie_watched_date';
    END IF;
    -- Preserve inserts from the deployed writer during migration-first rollouts.
    NEW."completed_on" := coalesce(NEW."started_on", (NEW."recorded_at" AT TIME ZONE 'UTC')::date);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "catalog_viewings_movie_watched_date" BEFORE INSERT OR UPDATE ON "catalog_viewings"
FOR EACH ROW EXECUTE FUNCTION "ensure_catalog_movie_watched_date"();
