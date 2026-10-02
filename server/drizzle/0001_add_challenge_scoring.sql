ALTER TABLE "challenges" ADD COLUMN "initial_points" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "min_points" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "decay" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_points_range" CHECK ("challenges"."initial_points" between 1 and 10000 and "challenges"."min_points" between 0 and "challenges"."initial_points");--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_decay_positive" CHECK ("challenges"."decay" >= 1);