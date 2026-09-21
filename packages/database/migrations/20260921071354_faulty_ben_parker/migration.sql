CREATE TABLE "catalog_movie_watches" (
	"user_id" uuid,
	"catalog_item_id" uuid,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_movie_watches_pkey" PRIMARY KEY("user_id","catalog_item_id")
);
--> statement-breakpoint
CREATE INDEX "catalog_movie_watches_catalog_item_id_index" ON "catalog_movie_watches" ("catalog_item_id");--> statement-breakpoint
ALTER TABLE "catalog_movie_watches" ADD CONSTRAINT "catalog_movie_watches_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_movie_watches" ADD CONSTRAINT "catalog_movie_watches_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE FUNCTION "enforce_catalog_movie_watch_item_type"() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "catalog_items"
		WHERE "id" = NEW."catalog_item_id"
			AND "type" = 'movie'
		FOR NO KEY UPDATE
	) THEN
		RAISE EXCEPTION 'catalog_movie_watches requires a movie catalog item'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "catalog_movie_watches_movie_only"
BEFORE INSERT OR UPDATE OF "catalog_item_id" ON "catalog_movie_watches"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_movie_watch_item_type"();--> statement-breakpoint
CREATE FUNCTION "prevent_watched_catalog_movie_type_change"() RETURNS trigger AS $$
BEGIN
	IF NEW."type" <> OLD."type" AND EXISTS (
		SELECT 1
		FROM "catalog_movie_watches"
		WHERE "catalog_item_id" = OLD."id"
	) THEN
		RAISE EXCEPTION 'watched catalog movies cannot change type'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "catalog_movie_watches_preserve_movie_type"
BEFORE UPDATE OF "type" ON "catalog_items"
FOR EACH ROW EXECUTE FUNCTION "prevent_watched_catalog_movie_type_change"();
