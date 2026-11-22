-- Three universal products everywhere: Academy, Intensive, External.
-- The detailed plans (CCBP Academy Smart, CCBP Intensive, …) stay on students and
-- applications as history, but are no longer offered in dropdowns.
INSERT INTO "Product" ("id", "code", "name", "category", "isActive", "updatedAt")
VALUES (gen_random_uuid(), 'ACADEMY', 'Academy', 'ACADEMY', TRUE, NOW()),
       (gen_random_uuid(), 'INTENSIVE', 'Intensive', 'ACADEMY_INTENSIVE', TRUE, NOW())
ON CONFLICT ("code") DO NOTHING;

UPDATE "Product" SET "isActive" = (code IN ('ACADEMY', 'INTENSIVE', 'External')), "updatedAt" = NOW();

-- Job requests list the universal product for each category they were eligible for.
INSERT INTO "JobRequestProduct" ("jobRequestId", "productId")
SELECT DISTINCT jp."jobRequestId", u.id
FROM "JobRequestProduct" jp
JOIN "Product" p ON p.id = jp."productId"
JOIN "Product" u ON u.category = p.category AND u.code IN ('ACADEMY', 'INTENSIVE', 'External')
ON CONFLICT DO NOTHING;
DELETE FROM "JobRequestProduct" jp
USING "Product" p
WHERE p.id = jp."productId" AND p.code NOT IN ('ACADEMY', 'INTENSIVE', 'External');
