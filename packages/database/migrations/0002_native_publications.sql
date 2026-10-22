CREATE TABLE "native_publications" (
  "room_id" uuid PRIMARY KEY REFERENCES "rooms"("id") ON DELETE CASCADE,
  "lease_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "holder_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "ingress_id" text NOT NULL UNIQUE,
  "identity" text NOT NULL UNIQUE
);
