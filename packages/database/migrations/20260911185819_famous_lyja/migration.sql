CREATE TABLE "catalog_item_follows" (
	"user_id" uuid,
	"catalog_item_id" uuid,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_item_follows_pkey" PRIMARY KEY("user_id","catalog_item_id")
);
--> statement-breakpoint
CREATE INDEX "catalog_item_follows_catalog_item_id_index" ON "catalog_item_follows" ("catalog_item_id");--> statement-breakpoint
CREATE INDEX "catalog_item_follows_user_followed_at_index" ON "catalog_item_follows" ("user_id","followed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "catalog_item_follows" ADD CONSTRAINT "catalog_item_follows_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_item_follows" ADD CONSTRAINT "catalog_item_follows_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;