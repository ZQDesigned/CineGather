ALTER TABLE party_word_bank ADD COLUMN modes text[] NOT NULL DEFAULT ARRAY['draw','quiz']::text[];
--> statement-breakpoint
ALTER TABLE party_word_bank ADD CONSTRAINT party_word_modes_valid CHECK (modes = ARRAY['draw']::text[] OR modes = ARRAY['quiz']::text[] OR modes = ARRAY['draw','quiz']::text[] OR modes = ARRAY['quiz','draw']::text[]);
