CREATE TABLE "catalog_title_requesters" (
	"request_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_title_requesters_pkey" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "catalog_title_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"type" "catalog_item_type" NOT NULL,
	"tmdb_id" integer NOT NULL,
	"card" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_title_requests_source_unique" UNIQUE("type","tmdb_id"),
	CONSTRAINT "catalog_title_requests_source_positive" CHECK ("tmdb_id" > 0)
);
--> statement-breakpoint
CREATE INDEX "catalog_title_requesters_owner_index" ON "catalog_title_requesters" ("user_id","created_at","request_id");--> statement-breakpoint
ALTER TABLE "catalog_title_requesters" ADD CONSTRAINT "catalog_title_requesters_YGUVomP8XBoG_fkey" FOREIGN KEY ("request_id") REFERENCES "catalog_title_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "catalog_title_requesters" ADD CONSTRAINT "catalog_title_requesters_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
