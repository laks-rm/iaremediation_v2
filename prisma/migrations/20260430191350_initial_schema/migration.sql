-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AuditTeam', 'Viewer', 'Auditee', 'Pending');

-- CreateEnum
CREATE TYPE "AuditType" AS ENUM ('IT', 'RegulatoryIT', 'Operations', 'RegulatoryOperations', 'External');

-- CreateEnum
CREATE TYPE "AuditOpinionRating" AS ENUM ('Satisfactory', 'NeedsImprovement', 'Unsatisfactory');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('High', 'Moderate', 'Low');

-- CreateEnum
CREATE TYPE "ControlRating" AS ENUM ('Effective', 'PartiallyEffective', 'NotEffective');

-- CreateEnum
CREATE TYPE "ActionPlanStatus" AS ENUM ('NotStarted', 'InProgress', 'PendingValidation', 'Closed', 'RiskAccepted', 'Dropped');

-- CreateEnum
CREATE TYPE "CreatedVia" AS ENUM ('Manual', 'AIIngestion', 'Migration', 'Standalone');

-- CreateEnum
CREATE TYPE "AuditLogAction" AS ENUM ('Create', 'Update', 'Delete', 'StatusChange', 'Login', 'LoginFailed', 'Logout', 'EvidenceUpload', 'EvidenceReplace', 'AIExtract', 'PasswordChange', 'PasswordReset', 'AccountLocked');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('Pending', 'Approved', 'Rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "employee_id" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_must_change" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_internal_auditor" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "job_title" TEXT,
    "department" TEXT,
    "team_l1" TEXT,
    "team_l2" TEXT,
    "team_l3" TEXT,
    "company" TEXT,
    "location" TEXT,
    "manager_name" TEXT,
    "manager_email" TEXT,
    "employment_status" TEXT,
    "last_working_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "entity_id" TEXT,
    "full_name" TEXT NOT NULL,
    "country" TEXT,
    "group_category" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "reference_number" TEXT,
    "audit_type" "AuditType" NOT NULL,
    "opinion_rating" "AuditOpinionRating",
    "report_issue_date" TIMESTAMP(3),
    "executive_summary" TEXT,
    "report_pdf_path" TEXT,
    "report_pdf_filename" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entities" (
    "audit_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,

    CONSTRAINT "audit_entities_pkey" PRIMARY KEY ("audit_id","entity_id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "audit_id" UUID,
    "is_standalone" BOOLEAN NOT NULL DEFAULT false,
    "external_ref" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "root_cause" TEXT,
    "potential_impact" TEXT,
    "recommendation" TEXT,
    "priority" "Priority",
    "control_rating" "ControlRating",
    "display_order" INTEGER NOT NULL DEFAULT 1,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_via" "CreatedVia" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_areas" (
    "id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "control_rating" "ControlRating",
    "finding_ref" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plans" (
    "id" UUID NOT NULL,
    "display_id" TEXT NOT NULL,
    "finding_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority",
    "status" "ActionPlanStatus" NOT NULL DEFAULT 'NotStarted',
    "original_target_date" TIMESTAMP(3),
    "current_target_date" TIMESTAMP(3),
    "required_evidence" TEXT,
    "department" TEXT,
    "was_implemented_at_issuance" BOOLEAN NOT NULL DEFAULT false,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "closure_remarks" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_via" "CreatedVia" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plan_entities" (
    "action_plan_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,

    CONSTRAINT "action_plan_entities_pkey" PRIMARY KEY ("action_plan_id","entity_id")
);

-- CreateTable
CREATE TABLE "action_plan_owners" (
    "id" UUID NOT NULL,
    "action_plan_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_plan_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plan_follow_up_auditors" (
    "id" UUID NOT NULL,
    "action_plan_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_plan_follow_up_auditors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plan_line_managers" (
    "id" UUID NOT NULL,
    "action_plan_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_plan_line_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "action_plan_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "description" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "action_plan_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "comment" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" UUID NOT NULL,
    "action_plan_id" UUID NOT NULL,
    "from_status" "ActionPlanStatus",
    "to_status" "ActionPlanStatus" NOT NULL,
    "remarks" TEXT,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_date_revisions" (
    "id" UUID NOT NULL,
    "action_plan_id" UUID NOT NULL,
    "old_date" TIMESTAMP(3),
    "new_date" TIMESTAMP(3),
    "justification" TEXT NOT NULL,
    "revised_by_id" UUID NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_date_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" "AuditLogAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_extractions" (
    "id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'Pending',
    "model_used" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "extracted_json" JSONB NOT NULL,
    "human_edits_json" JSONB,
    "rejection_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_import_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "change_type" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "batch_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_import_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_is_active_idx" ON "users"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "entities_code_key" ON "entities"("code");

-- CreateIndex
CREATE INDEX "findings_audit_id_idx" ON "findings"("audit_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_plans_display_id_key" ON "action_plans"("display_id");

-- CreateIndex
CREATE INDEX "action_plans_status_idx" ON "action_plans"("status");

-- CreateIndex
CREATE INDEX "action_plans_is_deleted_idx" ON "action_plans"("is_deleted");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_idx" ON "audit_log"("entity_type");

-- CreateIndex
CREATE INDEX "audit_log_entity_id_idx" ON "audit_log"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entities" ADD CONSTRAINT "audit_entities_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entities" ADD CONSTRAINT "audit_entities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_areas" ADD CONSTRAINT "control_areas_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_entities" ADD CONSTRAINT "action_plan_entities_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_entities" ADD CONSTRAINT "action_plan_entities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_owners" ADD CONSTRAINT "action_plan_owners_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_owners" ADD CONSTRAINT "action_plan_owners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_owners" ADD CONSTRAINT "action_plan_owners_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_follow_up_auditors" ADD CONSTRAINT "action_plan_follow_up_auditors_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_follow_up_auditors" ADD CONSTRAINT "action_plan_follow_up_auditors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_line_managers" ADD CONSTRAINT "action_plan_line_managers_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_line_managers" ADD CONSTRAINT "action_plan_line_managers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_date_revisions" ADD CONSTRAINT "target_date_revisions_action_plan_id_fkey" FOREIGN KEY ("action_plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_date_revisions" ADD CONSTRAINT "target_date_revisions_revised_by_id_fkey" FOREIGN KEY ("revised_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_import_notifications" ADD CONSTRAINT "user_import_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
