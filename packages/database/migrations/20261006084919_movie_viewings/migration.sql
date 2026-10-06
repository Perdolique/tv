CREATE TABLE "catalog_viewing_contexts" (
	"user_id" uuid,
	"catalog_item_id" uuid,
	"current_viewing_id" uuid,
	"context_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "catalog_viewing_contexts_pkey" PRIMARY KEY("user_id","catalog_item_id"),
	CONSTRAINT "catalog_viewing_contexts_version_nonnegative" CHECK ("context_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_viewing_creations" (
	"user_id" uuid,
	"request_id" uuid,
	"catalog_item_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"viewing_id" uuid,
	CONSTRAINT "catalog_viewing_creations_pkey" PRIMARY KEY("user_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_viewings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"started_on" date,
	"completed_on" date,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalog_viewings_owner_item_id_unique" UNIQUE("user_id","catalog_item_id","id"),
	CONSTRAINT "catalog_viewings_completed_only" CHECK ("status" = 'completed'),
	CONSTRAINT "catalog_viewings_revision_positive" CHECK ("revision" > 0),
	CONSTRAINT "catalog_viewings_date_order" CHECK ("started_on" <= "completed_on"),
	CONSTRAINT "catalog_viewings_date_range" CHECK (("started_on" IS NULL OR "started_on" BETWEEN '0001-01-01'::date AND '9999-12-31'::date) AND ("completed_on" IS NULL OR "completed_on" BETWEEN '0001-01-01'::date AND '9999-12-31'::date))
);
--> statement-breakpoint
-- Block legacy writes before copying marks; the migrator runs this in one transaction.
LOCK TABLE "catalog_movie_watches" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO "catalog_viewings" ("user_id", "catalog_item_id", "recorded_at")
SELECT "user_id", "catalog_item_id", "marked_at" FROM "catalog_movie_watches";
--> statement-breakpoint
INSERT INTO "catalog_viewing_contexts" ("user_id", "catalog_item_id", "current_viewing_id", "context_version")
SELECT "user_id", "catalog_item_id", "id", 1 FROM "catalog_viewings";
--> statement-breakpoint
DROP TABLE "catalog_movie_watches";--> statement-breakpoint
CREATE INDEX "catalog_viewing_contexts_current_index" ON "catalog_viewing_contexts" ("current_viewing_id");--> statement-breakpoint
CREATE INDEX "catalog_viewing_creations_viewing_index" ON "catalog_viewing_creations" ("viewing_id");--> statement-breakpoint
CREATE INDEX "catalog_viewing_creations_item_index" ON "catalog_viewing_creations" ("catalog_item_id");--> statement-breakpoint
CREATE INDEX "catalog_viewings_owner_item_recorded_index" ON "catalog_viewings" ("user_id","catalog_item_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_viewings_owner_recorded_index" ON "catalog_viewings" ("user_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_viewings_item_index" ON "catalog_viewings" ("catalog_item_id");--> statement-breakpoint
ALTER TABLE "catalog_viewing_contexts" ADD CONSTRAINT "catalog_viewing_contexts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_contexts" ADD CONSTRAINT "catalog_viewing_contexts_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_contexts" ADD CONSTRAINT "catalog_viewing_contexts_owner_item_fk" FOREIGN KEY ("user_id","catalog_item_id","current_viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE SET NULL ("current_viewing_id");--> statement-breakpoint
ALTER TABLE "catalog_viewing_creations" ADD CONSTRAINT "catalog_viewing_creations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_creations" ADD CONSTRAINT "catalog_viewing_creations_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewing_creations" ADD CONSTRAINT "catalog_viewing_creations_owner_item_fk" FOREIGN KEY ("user_id","catalog_item_id","viewing_id") REFERENCES "catalog_viewings"("user_id","catalog_item_id","id") ON DELETE SET NULL ("viewing_id");--> statement-breakpoint
ALTER TABLE "catalog_viewings" ADD CONSTRAINT "catalog_viewings_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_viewings" ADD CONSTRAINT "catalog_viewings_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE VIEW "catalog_movie_watches" AS (SELECT user_id, catalog_item_id, max(recorded_at) AS marked_at FROM catalog_viewings WHERE status = 'completed' GROUP BY user_id, catalog_item_id);
--> statement-breakpoint
DROP TRIGGER "catalog_movie_watches_preserve_movie_type" ON "catalog_items";
--> statement-breakpoint
DROP FUNCTION "prevent_watched_catalog_movie_type_change"();
--> statement-breakpoint
DROP FUNCTION "enforce_catalog_movie_watch_item_type"();
--> statement-breakpoint
CREATE FUNCTION "enforce_catalog_viewing_item_type"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "catalog_items" WHERE "id" = NEW."catalog_item_id" AND "type" = 'movie' FOR NO KEY UPDATE
  ) THEN
    RAISE EXCEPTION 'catalog_viewings requires a movie catalog item' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "catalog_viewings_movie_only"
BEFORE INSERT OR UPDATE OF "catalog_item_id" ON "catalog_viewings"
FOR EACH ROW EXECUTE FUNCTION "enforce_catalog_viewing_item_type"();
--> statement-breakpoint
CREATE FUNCTION "prevent_viewed_catalog_movie_type_change"() RETURNS trigger AS $$
BEGIN
  IF NEW."type" <> OLD."type" AND EXISTS (
    SELECT 1 FROM "catalog_viewings" WHERE "catalog_item_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'catalog movies with viewings cannot change type' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "catalog_viewings_preserve_movie_type"
BEFORE UPDATE OF "type" ON "catalog_items"
FOR EACH ROW EXECUTE FUNCTION "prevent_viewed_catalog_movie_type_change"();
