-- Add link evidence support to the evidence table
ALTER TABLE "evidence" ADD COLUMN "evidence_type" TEXT NOT NULL DEFAULT 'file';
ALTER TABLE "evidence" ADD COLUMN "link_url" TEXT;
ALTER TABLE "evidence" ADD COLUMN "link_source_type" TEXT;

-- Make file-specific fields nullable for link evidence
ALTER TABLE "evidence" ALTER COLUMN "filename" DROP NOT NULL;
ALTER TABLE "evidence" ALTER COLUMN "original_name" DROP NOT NULL;
ALTER TABLE "evidence" ALTER COLUMN "file_path" DROP NOT NULL;
ALTER TABLE "evidence" ALTER COLUMN "file_size" DROP NOT NULL;
ALTER TABLE "evidence" ALTER COLUMN "mime_type" DROP NOT NULL;
