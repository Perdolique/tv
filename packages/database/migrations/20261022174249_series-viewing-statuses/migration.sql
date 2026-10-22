ALTER TABLE "catalog_viewings" DROP CONSTRAINT "catalog_viewings_status", ADD CONSTRAINT "catalog_viewings_status" CHECK ("status" IN ('watching', 'paused', 'dropped', 'completed'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_catalog_viewing_item_type"() RETURNS trigger AS $$
DECLARE item_type catalog_item_type;
BEGIN
  SELECT "type" INTO item_type FROM "catalog_items" WHERE "id" = NEW."catalog_item_id" FOR NO KEY UPDATE;
  IF item_type IS NULL OR (item_type = 'movie' AND (NEW."status" <> 'completed' OR NEW."completed_on" IS NULL)) THEN
    RAISE EXCEPTION 'Movie viewings require a completion date and completed status' USING ERRCODE = '23514';
  END IF;
  IF item_type = 'series' AND (NEW."started_on" IS NULL OR (NEW."status" = 'completed' AND NEW."completed_on" IS NULL) OR (NEW."status" <> 'completed' AND NEW."completed_on" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Series viewings require dates matching their status' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
