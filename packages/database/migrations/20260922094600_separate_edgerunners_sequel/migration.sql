-- Keep the original series and its follows separate from the standalone sequel.
INSERT INTO catalog_items (id, type, release_year)
VALUES ('10000000-0000-7000-8000-000000000025', 'series', 2026);--> statement-breakpoint
INSERT INTO catalog_item_titles (catalog_item_id, locale, title, is_original)
VALUES ('10000000-0000-7000-8000-000000000025', 'en', 'Cyberpunk: Edgerunners 2', true);--> statement-breakpoint
DO $$
DECLARE
  moved_releases integer;
BEGIN
  UPDATE catalog_releases
  SET catalog_item_id = '10000000-0000-7000-8000-000000000025', season_number = 1
  WHERE catalog_item_id = '10000000-0000-7000-8000-000000000020'
    AND id BETWEEN '20000000-0000-7000-8000-000000000039' AND '20000000-0000-7000-8000-000000000048'
    AND season_number = 2
    AND episode_number BETWEEN 1 AND 10;

  GET DIAGNOSTICS moved_releases = ROW_COUNT;

  IF moved_releases <> 10 THEN
    RAISE EXCEPTION 'expected to move 10 Edgerunners sequel releases, moved %', moved_releases;
  END IF;
END $$;
