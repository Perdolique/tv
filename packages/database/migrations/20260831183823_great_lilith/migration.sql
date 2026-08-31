CREATE TYPE "catalog_item_type" AS ENUM('movie', 'series');--> statement-breakpoint
CREATE TABLE "catalog_item_titles" (
	"catalog_item_id" uuid,
	"locale" varchar(35),
	"title" text NOT NULL,
	"is_original" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalog_item_titles_pkey" PRIMARY KEY("catalog_item_id","locale")
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"type" "catalog_item_type" NOT NULL,
	"release_year" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_item_titles_original_unique" ON "catalog_item_titles" ("catalog_item_id") WHERE "is_original";--> statement-breakpoint
ALTER TABLE "catalog_item_titles" ADD CONSTRAINT "catalog_item_titles_catalog_item_id_catalog_items_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "catalog_items" ("id", "type", "release_year") VALUES
	('10000000-0000-4000-8000-000000000001', 'movie', 1986),
	('10000000-0000-4000-8000-000000000002', 'movie', 1995),
	('10000000-0000-4000-8000-000000000003', 'movie', 2021),
	('10000000-0000-4000-8000-000000000004', 'movie', 2014),
	('10000000-0000-4000-8000-000000000005', 'movie', 1974),
	('10000000-0000-4000-8000-000000000006', 'movie', 2013),
	('10000000-0000-4000-8000-000000000007', 'series', 2010),
	('10000000-0000-4000-8000-000000000008', 'series', 2022),
	('10000000-0000-4000-8000-000000000009', 'series', 2002),
	('10000000-0000-4000-8000-000000000010', 'series', 2019),
	('10000000-0000-4000-8000-000000000011', 'series', 2004),
	('10000000-0000-4000-8000-000000000012', 'series', 2019);--> statement-breakpoint
INSERT INTO "catalog_item_titles" ("catalog_item_id", "locale", "title", "is_original") VALUES
	('10000000-0000-4000-8000-000000000001', 'en', 'Kin-dza-dza!', false),
	('10000000-0000-4000-8000-000000000001', 'ru', 'Кин-дза-дза!', true),
	('10000000-0000-4000-8000-000000000002', 'en', 'Dead Man', true),
	('10000000-0000-4000-8000-000000000002', 'ru', 'Мертвец', false),
	('10000000-0000-4000-8000-000000000003', 'en', 'Dune', true),
	('10000000-0000-4000-8000-000000000003', 'ru', 'Дюна', false),
	('10000000-0000-4000-8000-000000000004', 'en', 'The Equalizer', true),
	('10000000-0000-4000-8000-000000000004', 'ru', 'Великий уравнитель', false),
	('10000000-0000-4000-8000-000000000005', 'en', 'Wedding Trough', false),
	('10000000-0000-4000-8000-000000000005', 'fr', 'Vase de noces', true),
	('10000000-0000-4000-8000-000000000005', 'ru', 'Свадебная ваза', false),
	('10000000-0000-4000-8000-000000000006', 'cs', 'Bella Mia', true),
	('10000000-0000-4000-8000-000000000006', 'en', 'Bella Mia', false),
	('10000000-0000-4000-8000-000000000006', 'ru', 'Белла миа', false),
	('10000000-0000-4000-8000-000000000007', 'en', 'Spartacus', true),
	('10000000-0000-4000-8000-000000000007', 'ru', 'Спартак', false),
	('10000000-0000-4000-8000-000000000008', 'en', '1923', true),
	('10000000-0000-4000-8000-000000000008', 'ru', '1923', false),
	('10000000-0000-4000-8000-000000000009', 'en', 'The Wire', true),
	('10000000-0000-4000-8000-000000000009', 'ru', 'Прослушка', false),
	('10000000-0000-4000-8000-000000000010', 'en', 'Chernobyl', true),
	('10000000-0000-4000-8000-000000000010', 'ru', 'Чернобыль', false),
	('10000000-0000-4000-8000-000000000011', 'en', 'Stargate Atlantis', true),
	('10000000-0000-4000-8000-000000000011', 'ru', 'Звёздные врата: Атлантида', false),
	('10000000-0000-4000-8000-000000000012', 'en', 'Kingdom', false),
	('10000000-0000-4000-8000-000000000012', 'ko', '킹덤', true),
	('10000000-0000-4000-8000-000000000012', 'ru', 'Королевство зомби', false);
