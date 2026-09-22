CREATE TABLE "catalog_episode_watches" (
	"user_id" uuid,
	"catalog_episode_id" uuid,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_episode_watches_pkey" PRIMARY KEY("user_id","catalog_episode_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_episodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"catalog_item_id" uuid NOT NULL,
	"season_number" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"source_title" text,
	"air_date" date,
	"tvmaze_episode_id" integer NOT NULL,
	CONSTRAINT "catalog_episodes_season_number_positive" CHECK ("season_number" > 0),
	CONSTRAINT "catalog_episodes_episode_number_positive" CHECK ("episode_number" > 0),
	CONSTRAINT "catalog_episodes_tvmaze_episode_id_positive" CHECK ("tvmaze_episode_id" > 0)
);
--> statement-breakpoint
CREATE INDEX "catalog_episode_watches_catalog_episode_id_index" ON "catalog_episode_watches" ("catalog_episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_episodes_catalog_item_season_episode_unique" ON "catalog_episodes" ("catalog_item_id","season_number","episode_number");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_episodes_tvmaze_episode_id_unique" ON "catalog_episodes" ("tvmaze_episode_id");--> statement-breakpoint
ALTER TABLE "catalog_episode_watches" ADD CONSTRAINT "catalog_episode_watches_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_episode_watches" ADD CONSTRAINT "catalog_episode_watches_ynhUEcsHjZFY_fkey" FOREIGN KEY ("catalog_episode_id") REFERENCES "catalog_episodes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_episodes" ADD CONSTRAINT "catalog_episodes_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE FUNCTION "enforce_catalog_episode_item_type"() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "catalog_items"
		WHERE "id" = NEW."catalog_item_id"
			AND "type" = 'series'
		FOR NO KEY UPDATE
	) THEN
		RAISE EXCEPTION 'catalog_episodes requires a series catalog item'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "catalog_episodes_series_only"
BEFORE INSERT OR UPDATE OF "catalog_item_id" ON "catalog_episodes"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_episode_item_type"();--> statement-breakpoint
CREATE FUNCTION "prevent_catalog_series_type_change"() RETURNS trigger AS $$
BEGIN
	IF NEW."type" <> OLD."type" AND EXISTS (
		SELECT 1
		FROM "catalog_episodes"
		WHERE "catalog_item_id" = OLD."id"
	) THEN
		RAISE EXCEPTION 'catalog series with episodes cannot change type'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "catalog_episodes_preserve_series_type"
BEFORE UPDATE OF "type" ON "catalog_items"
FOR EACH ROW EXECUTE FUNCTION "prevent_catalog_series_type_change"();--> statement-breakpoint
-- Static TVMaze snapshot checked 2026-09-21:
-- https://www.tvmaze.com/shows/30770/chernobyl
-- https://api.tvmaze.com/shows/30770/episodes
DO $$
DECLARE
	chernobyl_id uuid;
	matching_items bigint;
BEGIN
	SELECT count(*), min(item."id"::text)::uuid
	INTO matching_items, chernobyl_id
	FROM "catalog_items" AS item
	INNER JOIN "catalog_item_titles" AS title
		ON title."catalog_item_id" = item."id"
	WHERE item."type" = 'series'
		AND item."release_year" = 2019
		AND title."locale" = 'en'
		AND title."title" = 'Chernobyl'
		AND title."is_original";

	IF matching_items <> 1 THEN
		RAISE EXCEPTION 'expected exactly one 2019 Chernobyl series, found %', matching_items;
	END IF;

	INSERT INTO "catalog_episodes" (
		"id",
		"catalog_item_id",
		"season_number",
		"episode_number",
		"source_title",
		"air_date",
		"tvmaze_episode_id"
	) VALUES
		('30000000-0000-7000-8000-000000000001', chernobyl_id, 1, 1, '1:23:45', '2019-05-06', 1594417),
		('30000000-0000-7000-8000-000000000002', chernobyl_id, 1, 2, 'Please Remain Calm', '2019-05-13', 1634381),
		('30000000-0000-7000-8000-000000000003', chernobyl_id, 1, 3, 'Open Wide, O Earth', '2019-05-20', 1634382),
		('30000000-0000-7000-8000-000000000004', chernobyl_id, 1, 4, 'The Happiness of All Mankind', '2019-05-27', 1634383),
		('30000000-0000-7000-8000-000000000005', chernobyl_id, 1, 5, 'Vichnaya Pamyat', '2019-06-03', 1634384);
END
$$;
