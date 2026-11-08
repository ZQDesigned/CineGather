CREATE TABLE party_categories (
 id uuid PRIMARY KEY, name text NOT NULL, name_key text NOT NULL,
 parent_id uuid REFERENCES party_categories(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1,
 CHECK (id IS DISTINCT FROM parent_id)
);
CREATE UNIQUE INDEX party_category_root_name ON party_categories(name_key) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX party_category_child_name ON party_categories(parent_id, name_key) WHERE parent_id IS NOT NULL;
CREATE FUNCTION check_party_category_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND (EXISTS (SELECT 1 FROM party_categories WHERE id=NEW.parent_id AND parent_id IS NOT NULL) OR EXISTS (SELECT 1 FROM party_categories WHERE parent_id=NEW.id)) THEN
  RAISE EXCEPTION 'party categories support at most two levels';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER party_category_depth BEFORE INSERT OR UPDATE ON party_categories FOR EACH ROW EXECUTE FUNCTION check_party_category_depth();
--> statement-breakpoint
INSERT INTO party_categories(id,name,name_key)
SELECT gen_random_uuid(), category, lower(category) FROM (SELECT DISTINCT category FROM party_word_bank) c;
INSERT INTO party_categories(id,name,name_key) VALUES (gen_random_uuid(),'游戏','游戏') ON CONFLICT DO NOTHING;
UPDATE party_categories SET parent_id=(SELECT id FROM party_categories WHERE parent_id IS NULL AND name='游戏')
WHERE name IN ('游戏角色','游戏道具','游戏玩法','经典游戏','明日方舟','王者荣耀','原神','崩坏：星穹铁道','无畏契约','三角洲行动','和平精英');
ALTER TABLE party_word_bank ADD COLUMN category_id uuid REFERENCES party_categories(id) ON DELETE RESTRICT;
UPDATE party_word_bank w SET category_id=c.id FROM party_categories c WHERE c.name=w.category;
CREATE INDEX party_word_category ON party_word_bank(category_id);
--> statement-breakpoint
CREATE TABLE party_bank_policy (
 id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL DEFAULT 1,
 draw_min_questions integer NOT NULL DEFAULT 20 CHECK(draw_min_questions BETWEEN 6 AND 10000),
 draw_min_categories integer NOT NULL DEFAULT 0 CHECK(draw_min_categories BETWEEN 0 AND 500),
 quiz_min_questions integer NOT NULL DEFAULT 20 CHECK(quiz_min_questions BETWEEN 3 AND 10000),
 quiz_min_categories integer NOT NULL DEFAULT 0 CHECK(quiz_min_categories BETWEEN 0 AND 500)
);
INSERT INTO party_bank_policy(id) VALUES(1);
--> statement-breakpoint
-- Compatibility for existing insert callers that still supply a single category name.
CREATE FUNCTION assign_party_word_category() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched uuid; matches integer;
BEGIN
 IF NEW.category_id IS NULL THEN
  SELECT count(*), (array_agg(id))[1] INTO matches, matched FROM party_categories WHERE name=NEW.category;
  IF matches > 1 THEN RAISE EXCEPTION 'ambiguous party category'; END IF;
  IF matches=0 THEN
   INSERT INTO party_categories(id,name,name_key) VALUES(gen_random_uuid(),NEW.category,lower(NEW.category)) ON CONFLICT DO NOTHING;
   SELECT id INTO matched FROM party_categories WHERE parent_id IS NULL AND name_key=lower(NEW.category);
  END IF;
  NEW.category_id=matched;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER party_word_category_assignment BEFORE INSERT OR UPDATE ON party_word_bank FOR EACH ROW EXECUTE FUNCTION assign_party_word_category();
