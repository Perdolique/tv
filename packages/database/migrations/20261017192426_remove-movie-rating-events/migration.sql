DELETE FROM "catalog_timeline_events" AS events
USING "catalog_items" AS items
WHERE events.catalog_item_id = items.id
  AND items.type = 'movie'
  AND events.kind = 'rating_changed';
