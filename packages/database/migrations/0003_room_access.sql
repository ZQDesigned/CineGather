ALTER TABLE "rooms" ADD COLUMN "code" text;
ALTER TABLE "rooms" ADD COLUMN "password_hash" text;
--> statement-breakpoint
DO $$
DECLARE room_row record; candidate text;
BEGIN
  FOR room_row IN SELECT id FROM rooms ORDER BY created_at, id LOOP
    candidate := upper(left(room_row.id::text, 8));
    WHILE EXISTS (SELECT 1 FROM rooms WHERE code = candidate) LOOP
      candidate := upper(left(md5(gen_random_uuid()::text), 8));
    END LOOP;
    UPDATE rooms SET code = candidate WHERE id = room_row.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_code_unique" UNIQUE ("code");
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_code_check" CHECK ("code" ~ '^[A-F0-9]{8}$');
