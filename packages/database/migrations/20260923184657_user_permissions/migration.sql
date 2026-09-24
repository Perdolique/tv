CREATE TABLE "user_permissions" (
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "user_permissions_pkey" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
REVOKE ALL ON TABLE "user_permissions" FROM PUBLIC;--> statement-breakpoint
-- The runtime role is provisioned in deployed environments, but not disposable local databases.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tv_app') THEN
    REVOKE ALL ON TABLE user_permissions FROM tv_app;
    GRANT SELECT ON TABLE user_permissions TO tv_app;
  END IF;
END $$;
