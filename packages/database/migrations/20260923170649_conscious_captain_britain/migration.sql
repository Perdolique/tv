CREATE TABLE "catalog_external_links" (
	"provider" text,
	"entity_type" text,
	"external_id" text,
	"catalog_item_id" uuid,
	"catalog_episode_id" uuid,
	CONSTRAINT "catalog_external_links_pkey" PRIMARY KEY("provider","entity_type","external_id"),
	CONSTRAINT "catalog_external_links_external_id_positive" CHECK ("external_id" ~ '^[1-9][0-9]*$'),
	CONSTRAINT "catalog_external_links_target" CHECK (("catalog_item_id" IS NULL) <> ("catalog_episode_id" IS NULL)),
	CONSTRAINT "catalog_external_links_source" CHECK (
    ("provider" = 'tmdb' AND "entity_type" IN ('movie', 'tv') AND "catalog_item_id" IS NOT NULL)
    OR ("provider" = 'tvmaze' AND "entity_type" = 'show' AND "catalog_item_id" IS NOT NULL)
    OR ("provider" = 'tvmaze' AND "entity_type" = 'episode' AND "catalog_episode_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_external_links_item_source_unique" ON "catalog_external_links" ("catalog_item_id","provider","entity_type") WHERE "catalog_item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_external_links_episode_source_unique" ON "catalog_external_links" ("catalog_episode_id","provider","entity_type") WHERE "catalog_episode_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_external_links" ADD CONSTRAINT "catalog_external_links_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_external_links" ADD CONSTRAINT "catalog_external_links_moTTrI8RbD50_fkey" FOREIGN KEY ("catalog_episode_id") REFERENCES "catalog_episodes"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE FUNCTION "enforce_catalog_external_link_item_type"() RETURNS trigger AS $$
BEGIN
  IF NEW.catalog_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM catalog_items AS item
    WHERE item.id = NEW.catalog_item_id
      AND (
        (NEW.provider = 'tmdb' AND NEW.entity_type = 'movie' AND item.type = 'movie')
        OR (NEW.entity_type IN ('tv', 'show') AND item.type = 'series')
      )
    FOR NO KEY UPDATE
  ) THEN
    RAISE EXCEPTION 'external source type does not match catalog item type'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "catalog_external_links_item_type"
BEFORE INSERT OR UPDATE OF "provider", "entity_type", "catalog_item_id" ON "catalog_external_links"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_external_link_item_type"();--> statement-breakpoint
CREATE FUNCTION "prevent_catalog_external_link_item_type_change"() RETURNS trigger AS $$
BEGIN
  IF NEW.type <> OLD.type AND EXISTS (
    SELECT 1
    FROM catalog_external_links AS link
    WHERE link.catalog_item_id = OLD.id
      AND (
        (link.provider = 'tmdb' AND link.entity_type = 'movie' AND NEW.type <> 'movie')
        OR (link.entity_type IN ('tv', 'show') AND NEW.type <> 'series')
      )
  ) THEN
    RAISE EXCEPTION 'catalog item type conflicts with an external source link'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "catalog_external_links_preserve_item_type"
BEFORE UPDATE OF "type" ON "catalog_items"
FOR EACH ROW EXECUTE FUNCTION "prevent_catalog_external_link_item_type_change"();--> statement-breakpoint
-- These exact source matches were reviewed in issues #51 and #60. Names and years only
-- locate those reviewed records in databases with environment-specific catalog UUIDs.
CREATE TEMPORARY TABLE tv_reviewed_catalog_links (
  provider text NOT NULL,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  item_type catalog_item_type NOT NULL,
  english_title text NOT NULL,
  release_year integer NOT NULL,
  PRIMARY KEY (provider, entity_type, external_id)
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO tv_reviewed_catalog_links VALUES
  ('tvmaze', 'show', '716', 'series', 'Spartacus', 2010),
  ('tvmaze', 'show', '60550', 'series', '1923', 2022),
  ('tvmaze', 'show', '179', 'series', 'The Wire', 2002),
  ('tvmaze', 'show', '30770', 'series', 'Chernobyl', 2019),
  ('tvmaze', 'show', '206', 'series', 'Stargate Atlantis', 2004),
  ('tvmaze', 'show', '26153', 'series', 'Kingdom', 2019),
  ('tvmaze', 'show', '30', 'series', 'American Horror Story', 2011),
  ('tvmaze', 'show', '48108', 'series', 'Percy Jackson and the Olympians', 2023),
  ('tvmaze', 'show', '83209', 'series', 'The Forsytes', 2025),
  ('tvmaze', 'show', '112', 'series', 'South Park', 1997),
  ('tvmaze', 'show', '91916', 'series', 'A Different World', 2026),
  ('tvmaze', 'show', '48945', 'series', 'Cyberpunk: Edgerunners', 2022),
  ('tvmaze', 'show', '88337', 'series', 'Cyberpunk: Edgerunners 2', 2026),
  ('tvmaze', 'show', '84008', 'series', 'Pride and Prejudice', 2026),
  ('tvmaze', 'show', '57137', 'series', 'The Gold', 2023),
  ('tmdb', 'movie', '438631', 'movie', 'Dune', 2021),
  ('tmdb', 'movie', '345571', 'movie', 'Bella Mia', 2013),
  ('tmdb', 'tv', '70593', 'series', 'Kingdom', 2019),
  ('tmdb', 'tv', '105248', 'series', 'Cyberpunk: Edgerunners', 2022),
  ('tmdb', 'tv', '326788', 'series', 'Cyberpunk: Edgerunners 2', 2026);--> statement-breakpoint
-- Keep the reviewed title, year, and type matches stable until their links are inserted.
LOCK TABLE catalog_items, catalog_item_titles IN SHARE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tv_reviewed_catalog_links AS reviewed
    LEFT JOIN catalog_item_titles AS title
      ON title.locale = 'en' AND title.title = reviewed.english_title
    LEFT JOIN catalog_items AS item
      ON item.id = title.catalog_item_id
        AND item.type = reviewed.item_type
        AND item.release_year = reviewed.release_year
    GROUP BY reviewed.provider, reviewed.entity_type, reviewed.external_id
    HAVING count(item.id) <> 1
  ) THEN
    RAISE EXCEPTION 'reviewed external source match is missing or ambiguous';
  END IF;
END $$;--> statement-breakpoint
INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_item_id)
SELECT reviewed.provider, reviewed.entity_type, reviewed.external_id, item.id
FROM tv_reviewed_catalog_links AS reviewed
JOIN catalog_item_titles AS title
  ON title.locale = 'en' AND title.title = reviewed.english_title
JOIN catalog_items AS item
  ON item.id = title.catalog_item_id
    AND item.type = reviewed.item_type
    AND item.release_year = reviewed.release_year;--> statement-breakpoint
INSERT INTO catalog_external_links (provider, entity_type, external_id, catalog_episode_id)
SELECT 'tvmaze', 'episode', episode.tvmaze_episode_id::text, episode.id
FROM catalog_episodes AS episode;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM catalog_episodes AS episode
    LEFT JOIN catalog_external_links AS link
      ON link.provider = 'tvmaze'
        AND link.entity_type = 'episode'
        AND link.external_id = episode.tvmaze_episode_id::text
        AND link.catalog_episode_id = episode.id
    WHERE link.catalog_episode_id IS NULL
  ) THEN
    RAISE EXCEPTION 'TVMaze episode links were not fully migrated';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "catalog_episodes" DROP CONSTRAINT "catalog_episodes_tvmaze_episode_id_positive";--> statement-breakpoint
DROP INDEX "catalog_episodes_tvmaze_episode_id_unique";--> statement-breakpoint
ALTER TABLE "catalog_episodes" DROP COLUMN "tvmaze_episode_id";
