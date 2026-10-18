CREATE INDEX "members_user_idx" ON "room_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_identity_check" CHECK ("friendships"."requester_id" <> "friendships"."recipient_id");--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_status_check" CHECK ("friendships"."status" IN ('pending', 'accepted'));--> statement-breakpoint
ALTER TABLE "room_invites" ADD CONSTRAINT "invites_uses_check" CHECK ("room_invites"."max_uses" > 0 AND "room_invites"."use_count" >= 0 AND "room_invites"."use_count" <= "room_invites"."max_uses");--> statement-breakpoint
ALTER TABLE "share_leases" ADD CONSTRAINT "leases_consistency_check" CHECK (num_nonnulls("share_leases"."holder_user_id", "share_leases"."lease_id", "share_leases"."expires_at") IN (0, 3));--> statement-breakpoint
ALTER TABLE "share_leases" ADD CONSTRAINT "leases_revision_check" CHECK ("share_leases"."revision" >= 0);--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "members_role_check" CHECK ("room_members"."role" IN ('owner', 'member'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "message_length_check" CHECK (char_length("messages"."body") BETWEEN 1 AND 2000);--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capacity_check" CHECK ("rooms"."max_members" BETWEEN 2 AND 10);--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_status_check" CHECK ("rooms"."status" IN ('active', 'closed'));