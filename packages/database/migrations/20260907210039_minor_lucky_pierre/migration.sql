-- Drizzle runs this migration in one transaction. Block writes before capturing ID maps.
LOCK TABLE catalog_items, catalog_item_titles, users, password_credentials, sessions IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TEMPORARY TABLE tv_uuidv7_row_counts ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM catalog_items) AS catalog_count,
  (SELECT count(*) FROM catalog_item_titles) AS title_count,
  (SELECT count(*) FROM users) AS user_count,
  (SELECT count(*) FROM password_credentials) AS credential_count,
  (SELECT count(*) FROM sessions) AS session_count;
--> statement-breakpoint
ALTER TABLE "catalog_item_titles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "poster_path" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT uuidv7();
--> statement-breakpoint
-- Seed IDs are still the historical UUIDv4 values here; artwork paths are independent of IDs.
CREATE TEMPORARY TABLE tv_catalog_details_seed (
  id uuid PRIMARY KEY,
  poster_path text NOT NULL,
  description_en text NOT NULL,
  description_ru text NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO tv_catalog_details_seed VALUES
('10000000-0000-4000-8000-000000000001'::uuid, '/posters/kin-dza-dza-1986.webp', 'A Moscow construction worker and a Georgian student accidentally reach a distant desert planet. Finding a way home means navigating a society obsessed with status, strange customs and the value of an ordinary match.', 'Московский прораб и грузинский студент случайно оказываются на далёкой пустынной планете. Чтобы вернуться домой, им приходится разбираться в странных обычаях, социальной иерархии и неожиданной ценности обычных спичек.')
,
('10000000-0000-4000-8000-000000000002'::uuid, '/posters/dead-man-1995.webp', 'Accountant William Blake heads west for a job and instead becomes a wounded fugitive. Guided by a Native American man called Nobody, he travels through an unfamiliar landscape as the boundary between life and death grows uncertain.', 'Бухгалтер Уильям Блейк едет на запад в поисках работы, но становится раненым беглецом. Вместе с индейцем по имени Никто он отправляется в путешествие, в котором постепенно стирается граница между жизнью и смертью.')
,
('10000000-0000-4000-8000-000000000003'::uuid, '/posters/dune-2021.webp', 'Paul Atreides arrives on Arrakis when his family takes control of the desert world that supplies the empire''s most valuable resource. Betrayal forces him and his mother into the wilderness, where the planet''s people may hold their future.', 'Пол Атрейдес прибывает на Арракис, когда его семья получает власть над пустынной планетой, добывающей важнейший ресурс империи. После предательства Пол и его мать вынуждены искать спасение в пустыне среди её коренных жителей.')
,
('10000000-0000-4000-8000-000000000004'::uuid, '/posters/the-equalizer-2014.webp', 'Robert McCall has built a quiet life in Boston, keeping his past to himself. When a young woman he befriends is brutally attacked, he uses his old skills against the criminal network that controls her life.', 'Роберт Макколл ведёт тихую жизнь в Бостоне и скрывает своё прошлое. Когда знакомая девушка становится жертвой жестокого нападения, он вновь применяет свои прежние навыки против преступной организации, которая распоряжается её судьбой.')
,
('10000000-0000-4000-8000-000000000005'::uuid, '/posters/wedding-trough-1974.webp', 'On an isolated Belgian farm, a man''s obsessive attachment to a sow becomes the centre of an increasingly disturbing existence. Thierry Zéno''s largely wordless film follows the collapse of the boundaries between human life, animal life and ritual.', 'На уединённой бельгийской ферме навязчивая привязанность мужчины к свинье становится центром всё более тревожной жизни. Почти бессловесный фильм Тьерри Зено исследует разрушение границ между человеческим существованием, животным миром и ритуалом.')
,
('10000000-0000-4000-8000-000000000006'::uuid, '/posters/bella-mia-2013.webp', 'A small herd escapes after a farmer is ordered to destroy cattle suspected of disease. Led by Bella, the animals take refuge in the forest, while members of the farmer''s family secretly help them and local hunters close in.', 'Небольшое стадо сбегает после решения уничтожить коров из-за подозрения на болезнь. Под предводительством Беллы животные скрываются в лесу, а близкие фермера тайно помогают им, пока местные охотники готовят облаву.')
,
('10000000-0000-4000-8000-000000000007'::uuid, '/posters/spartacus-2010.webp', 'Betrayed by the Romans and separated from his wife, a Thracian warrior is sold into slavery. In a gladiator school in Capua, Spartacus fights to survive the arena and the ambitions of those who profit from it.', 'Преданный римлянами и разлучённый с женой фракийский воин оказывается в рабстве. В гладиаторской школе Капуи Спартак борется за жизнь на арене и против амбиций тех, кто зарабатывает на чужой смерти.')
,
('10000000-0000-4000-8000-000000000008'::uuid, '/posters/1923-2022.webp', 'A new generation of the Dutton family struggles to hold on to its Montana ranch in the early twentieth century. Drought, prohibition, economic hardship and powerful rivals threaten the home Jacob and Cara Dutton are determined to protect.', 'Новое поколение семьи Даттон пытается сохранить ранчо в Монтане в начале двадцатого века. Засуха, сухой закон, экономические трудности и влиятельные соперники угрожают дому, который Джейкоб и Кара Даттон намерены защитить.')
,
('10000000-0000-4000-8000-000000000009'::uuid, '/posters/the-wire-2002.webp', 'A Baltimore police investigation into a drug organisation reveals a city shaped by institutions as much as individuals. Across its seasons, the series follows connections between the streets, the docks, politics, schools and the press.', 'Расследование деятельности наркогруппировки в Балтиморе раскрывает город, жизнью которого управляют не только отдельные люди, но и общественные институты. Сериал постепенно связывает улицы, порт, политику, школы и журналистику в одну историю.')
,
('10000000-0000-4000-8000-000000000010'::uuid, '/posters/chernobyl-2019.webp', 'After the 1986 explosion at the Chernobyl nuclear power plant, scientists, workers and emergency crews struggle to contain the disaster. Their response unfolds against a system whose secrecy and denial make the consequences harder to confront.', 'После взрыва на Чернобыльской АЭС в 1986 году учёные, работники станции и спасатели пытаются остановить катастрофу. Их борьба разворачивается в условиях секретности и отрицания, которые мешают осознать масштаб произошедшего.')
,
('10000000-0000-4000-8000-000000000011'::uuid, '/posters/stargate-atlantis-2004.webp', 'An expedition from Earth discovers the lost city of Atlantis in the Pegasus galaxy. Using its Stargate, a team of scientists and soldiers explores new worlds while confronting the Wraith and searching for a way to protect their new home.', 'Экспедиция с Земли обнаруживает затерянный город Атлантиду в галактике Пегас. Через Звёздные врата учёные и военные исследуют новые миры, противостоят рейфам и ищут способ защитить свой новый дом.')
,
('10000000-0000-4000-8000-000000000012'::uuid, '/posters/kingdom-2019.webp', 'In Joseon-era Korea, Crown Prince Lee Chang investigates the mystery surrounding his father''s illness. A spreading plague turns the dead into a threat to the living, while a struggle for the throne obstructs his efforts to save the kingdom.', 'В Корее эпохи Чосон наследный принц Ли Чхан пытается выяснить правду о болезни отца. Распространяющаяся эпидемия превращает мёртвых в угрозу для живых, а борьба за престол мешает принцу спасти страну.');
--> statement-breakpoint
UPDATE catalog_items AS item
SET poster_path = seed.poster_path
FROM tv_catalog_details_seed AS seed
WHERE item.id = seed.id;
--> statement-breakpoint
UPDATE catalog_item_titles AS title
SET description = CASE title.locale WHEN 'en' THEN seed.description_en ELSE seed.description_ru END
FROM tv_catalog_details_seed AS seed
WHERE title.catalog_item_id = seed.id AND title.locale IN ('en', 'ru');
--> statement-breakpoint
ALTER TABLE catalog_item_titles ALTER CONSTRAINT catalog_item_titles_catalog_item_id_catalog_items_id_fkey DEFERRABLE;
--> statement-breakpoint
ALTER TABLE password_credentials ALTER CONSTRAINT password_credentials_user_id_users_id_fkey DEFERRABLE;
--> statement-breakpoint
ALTER TABLE sessions ALTER CONSTRAINT sessions_user_id_users_id_fkey DEFERRABLE;
--> statement-breakpoint
SET CONSTRAINTS catalog_item_titles_catalog_item_id_catalog_items_id_fkey, password_credentials_user_id_users_id_fkey, sessions_user_id_users_id_fkey DEFERRED;
--> statement-breakpoint
CREATE TEMPORARY TABLE tv_catalog_uuidv7_ids ON COMMIT DROP AS
SELECT id AS old_id, uuidv7() AS new_id FROM catalog_items WHERE uuid_extract_version(id) = 4;
--> statement-breakpoint
CREATE TEMPORARY TABLE tv_user_uuidv7_ids ON COMMIT DROP AS
SELECT id AS old_id, uuidv7() AS new_id FROM users WHERE uuid_extract_version(id) = 4;
--> statement-breakpoint
CREATE TEMPORARY TABLE tv_session_uuidv7_ids ON COMMIT DROP AS
SELECT id AS old_id, uuidv7() AS new_id FROM sessions WHERE uuid_extract_version(id) = 4;
--> statement-breakpoint
UPDATE catalog_items AS item SET id = ids.new_id FROM tv_catalog_uuidv7_ids AS ids WHERE item.id = ids.old_id;
--> statement-breakpoint
UPDATE catalog_item_titles AS title SET catalog_item_id = ids.new_id FROM tv_catalog_uuidv7_ids AS ids WHERE title.catalog_item_id = ids.old_id;
--> statement-breakpoint
UPDATE users AS account SET id = ids.new_id FROM tv_user_uuidv7_ids AS ids WHERE account.id = ids.old_id;
--> statement-breakpoint
UPDATE password_credentials AS credential SET user_id = ids.new_id FROM tv_user_uuidv7_ids AS ids WHERE credential.user_id = ids.old_id;
--> statement-breakpoint
UPDATE sessions AS session SET user_id = ids.new_id FROM tv_user_uuidv7_ids AS ids WHERE session.user_id = ids.old_id;
--> statement-breakpoint
UPDATE sessions AS session SET id = ids.new_id FROM tv_session_uuidv7_ids AS ids WHERE session.id = ids.old_id;
--> statement-breakpoint
-- Flush deferred checks before restoring the original constraint definitions.
SET CONSTRAINTS catalog_item_titles_catalog_item_id_catalog_items_id_fkey, password_credentials_user_id_users_id_fkey, sessions_user_id_users_id_fkey IMMEDIATE;
--> statement-breakpoint
ALTER TABLE catalog_item_titles ALTER CONSTRAINT catalog_item_titles_catalog_item_id_catalog_items_id_fkey NOT DEFERRABLE;
--> statement-breakpoint
ALTER TABLE password_credentials ALTER CONSTRAINT password_credentials_user_id_users_id_fkey NOT DEFERRABLE;
--> statement-breakpoint
ALTER TABLE sessions ALTER CONSTRAINT sessions_user_id_users_id_fkey NOT DEFERRABLE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT id FROM catalog_items WHERE uuid_extract_version(id) IS DISTINCT FROM 7
    UNION ALL SELECT id FROM users WHERE uuid_extract_version(id) IS DISTINCT FROM 7
    UNION ALL SELECT id FROM sessions WHERE uuid_extract_version(id) IS DISTINCT FROM 7
  ) THEN
    RAISE EXCEPTION 'UUIDv7 migration left unsupported persisted identifiers';
  END IF;
  IF (SELECT count(*) FROM catalog_items) <> (SELECT catalog_count FROM tv_uuidv7_row_counts)
    OR (SELECT count(*) FROM catalog_item_titles) <> (SELECT title_count FROM tv_uuidv7_row_counts)
    OR (SELECT count(*) FROM users) <> (SELECT user_count FROM tv_uuidv7_row_counts)
    OR (SELECT count(*) FROM password_credentials) <> (SELECT credential_count FROM tv_uuidv7_row_counts)
    OR (SELECT count(*) FROM sessions) <> (SELECT session_count FROM tv_uuidv7_row_counts)
  THEN
    RAISE EXCEPTION 'UUIDv7 migration changed row counts';
  END IF;
END
$$;
