CREATE TABLE "email_verification_tokens" (
	"token_hash" varchar(64) PRIMARY KEY,
	"email" varchar(254) NOT NULL,
	"redirect_to" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_verification_tokens_email_index" ON "email_verification_tokens" ("email");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_expires_at_index" ON "email_verification_tokens" ("expires_at");