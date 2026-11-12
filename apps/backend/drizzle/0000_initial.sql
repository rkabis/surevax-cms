CREATE SCHEMA "migration";
--> statement-breakpoint
CREATE TYPE "public"."administration_route" AS ENUM('IM', 'SC', 'ID', 'IV', 'PO', 'IN', 'Topical', 'INF');--> statement-breakpoint
CREATE TYPE "public"."animal_outcome" AS ENUM('AliveHealthy', 'AliveSick', 'DiedNaturally', 'DiedUnknownCause', 'KilledForTesting', 'LostToFollowup');--> statement-breakpoint
CREATE TYPE "public"."animal_vaccination_status" AS ENUM('Vaccinated', 'NotVaccinated', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."approval_request_type" AS ENUM('void_transaction', 'inventory_adjustment', 'schedule_change', 'discount_override', 'patient_erasure', 'emergency_access');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'BREAK_GLASS', 'CROSS_BRANCH_ACCESS', 'TRANSACTION_MODIFY', 'SCHEDULE_CHANGE', 'PERMISSION_CHANGE', 'CONFIG_CHANGE', 'EXPORT', 'PRINT', 'AUDIT_ACCESS');--> statement-breakpoint
CREATE TYPE "public"."bite_species" AS ENUM('Dog', 'Cat', 'Bat', 'Monkey', 'Other');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('Draft', 'Submitted', 'Acknowledged', 'InReview', 'Approved', 'PartiallyApproved', 'Denied', 'Paid', 'Appealed');--> statement-breakpoint
CREATE TYPE "public"."clinical_order_status" AS ENUM('Scheduled', 'Pending', 'Completed', 'Missed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."clinical_order_type" AS ENUM('Standing_Order', 'Ad_Hoc', 'STAT');--> statement-breakpoint
CREATE TYPE "public"."consenter_relation" AS ENUM('Patient', 'Parent', 'Guardian', 'Spouse', 'Caregiver', 'Other');--> statement-breakpoint
CREATE TYPE "public"."discount_id_type" AS ENUM('OSCA', 'PWD', 'Other');--> statement-breakpoint
CREATE TYPE "public"."drawer_state" AS ENUM('Open', 'Closed', 'Reconciled', 'Discrepancy');--> statement-breakpoint
CREATE TYPE "public"."encounter_specialty" AS ENUM('Rabies', 'Flu', 'Vaccination', 'General');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('Open', 'InProgress', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."exposure_category" AS ENUM('I', 'II', 'III');--> statement-breakpoint
CREATE TYPE "public"."external_immunization_date_precision" AS ENUM('Exact', 'Estimated', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."fat_test_result" AS ENUM('Positive', 'Negative', 'Pending', 'NotTested');--> statement-breakpoint
CREATE TYPE "public"."inventory_transfer_status" AS ENUM('PendingReceipt', 'Received', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."lab_order_status" AS ENUM('Pending', 'Sent', 'ResultReceived', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('In', 'Out', 'Adjustment', 'Transfer', 'Expire');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('SMS', 'Email', 'Push');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('Queued', 'Sent', 'Failed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."payer_type" AS ENUM('HMO', 'Corporate', 'Government', 'Promo');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('Cash', 'GCash', 'Maya', 'BankTransfer', 'Card', 'PayMongo', 'HMO', 'Corporate', 'Other', 'Credit');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('Vaccine', 'Consultation', 'Lab', 'Procedure', 'Product');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('Male', 'Female', 'Other');--> statement-breakpoint
CREATE TYPE "public"."standing_order_status" AS ENUM('Active', 'Completed', 'Discontinued', 'Suspended');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('Draft', 'Pending', 'Paid', 'Voided', 'Refunded');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SuperAdmin', 'TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Cashier', 'Branch');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('Active', 'Inactive', 'Locked', 'PendingActivation');--> statement-breakpoint
CREATE TABLE "adverse_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"case_no" text,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"clinical_order_id" bigint,
	"encounter_id" bigint,
	"lot_id" bigint,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_by_id" bigint,
	"onset_at" timestamp with time zone,
	"severity" text NOT NULL,
	"outcome" text,
	"description" text NOT NULL,
	"symptoms_coded" jsonb,
	"treatment_given" text,
	"reported_to_authority_at" timestamp with time zone,
	"authority_reference_number" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "adverse_events_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "animal_observation_followups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"bite_incident_id" bigint NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"outcome" "animal_outcome",
	"fat_test_result" "fat_test_result",
	"outcome_observed_at" timestamp with time zone,
	"outcome_recorded_at" timestamp with time zone,
	"outcome_recorded_by_id" bigint,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "animal_observation_followups_display_id_unique" UNIQUE("display_id"),
	CONSTRAINT "animal_followups_status_check" CHECK ("animal_observation_followups"."status" IN ('Pending', 'Completed', 'Cancelled')),
	CONSTRAINT "animal_followups_outcome_state_check" CHECK (("animal_observation_followups"."status" = 'Completed' AND "animal_observation_followups"."outcome" IS NOT NULL AND "animal_observation_followups"."outcome_recorded_at" IS NOT NULL) OR ("animal_observation_followups"."status" IN ('Pending', 'Cancelled') AND "animal_observation_followups"."outcome" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"booking_ref" text,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"provider_id" bigint,
	"location_id" bigint,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"scheduled_end_at" timestamp with time zone NOT NULL,
	"appointment_type" text NOT NULL,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	"reason" text,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" bigint,
	"cancellation_reason" text,
	"encounter_id" bigint,
	"during" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "appointments_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "appointments_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"approval_request_id" bigint NOT NULL,
	"decision" text NOT NULL,
	"decided_by_id" bigint NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "approval_decisions_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"request_type" "approval_request_type" NOT NULL,
	"description" text NOT NULL,
	"details" text,
	"status" "approval_status" DEFAULT 'Pending' NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"requested_by_id" bigint NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"required_approvers" integer DEFAULT 1 NOT NULL,
	"approver_role" "user_role",
	"reviewed_by_id" bigint,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_backend" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_hash_sha256" text NOT NULL,
	"is_encrypted" boolean DEFAULT true NOT NULL,
	"category" text,
	"metadata" jsonb,
	"uploaded_by_id" bigint,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachments_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint,
	"session_id" bigint,
	"correlation_id" text,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_display_id" text,
	"branch_id" bigint,
	"ip_address" text,
	"user_agent" text,
	"changes" jsonb,
	"metadata" jsonb,
	"chain_sequence" bigint NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bite_incidents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"incident_no" text,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"patient_standing_order_id" bigint,
	"incident_date" date NOT NULL,
	"species" "bite_species" NOT NULL,
	"animal_vaccination_status" "animal_vaccination_status" NOT NULL,
	"animal_vaccination_doc_date" date,
	"animal_age_months" integer,
	"exposure_category" "exposure_category" NOT NULL,
	"bite_site" text NOT NULL,
	"requires_observation" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"deleted_at" timestamp with time zone,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "bite_incidents_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"province" text,
	"contact_number" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"timezone" text,
	"settings" jsonb,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "branches_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "cash_deposits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"cash_drawer_session_id" bigint NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"deposit_slip_number" text,
	"deposited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"voided_at" timestamp with time zone,
	"voided_by_id" bigint,
	"void_reason" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "cash_deposits_display_id_unique" UNIQUE("display_id"),
	CONSTRAINT "cash_deposits_amount_positive_check" CHECK ("cash_deposits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "cash_drawer_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"location_id" bigint,
	"state" "drawer_state" DEFAULT 'Open' NOT NULL,
	"opening_float" numeric(12, 2) NOT NULL,
	"opening_denominations" jsonb,
	"closing_total_declared" numeric(12, 2),
	"closing_denominations" jsonb,
	"expected_total" numeric(12, 2),
	"variance" numeric(12, 2),
	"variance_reason" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"reconciled_by_id" bigint,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "cash_drawer_sessions_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "claim_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"claim_id" bigint NOT NULL,
	"transaction_item_id" bigint NOT NULL,
	"service_code" text,
	"diagnosis_link_positions" jsonb,
	"quantity" numeric(8, 2) NOT NULL,
	"billed_amount" numeric(12, 2) NOT NULL,
	"approved_amount" numeric(12, 2),
	"denied_amount" numeric(12, 2),
	"denial_code" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "claim_items_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"payer_id" bigint NOT NULL,
	"payer_contract_id" bigint,
	"patient_id" bigint NOT NULL,
	"encounter_id" bigint,
	"transaction_id" bigint,
	"claim_no" text NOT NULL,
	"external_claim_number" text,
	"status" "claim_status" DEFAULT 'Draft' NOT NULL,
	"loa_number" text,
	"loa_issued_at" timestamp with time zone,
	"loa_expires_at" timestamp with time zone,
	"diagnoses_snapshot" jsonb,
	"total_billed" numeric(12, 2) NOT NULL,
	"total_approved" numeric(12, 2),
	"total_denied" numeric(12, 2),
	"total_paid" numeric(12, 2),
	"patient_responsibility" numeric(12, 2),
	"submitted_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"decision_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"denial_code" text,
	"denial_reason" text,
	"appeal_notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "claims_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "claims_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "clinical_order_schedule_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"clinical_order_id" bigint NOT NULL,
	"old_date" date,
	"new_date" date NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "clinical_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_standing_order_id" bigint,
	"fan_out_transaction_id" bigint,
	"service_id" text NOT NULL,
	"encounter_id" bigint,
	"patient_id" bigint NOT NULL,
	"order_type" "clinical_order_type" NOT NULL,
	"status" "clinical_order_status" DEFAULT 'Scheduled' NOT NULL,
	"original_scheduled_date" timestamp with time zone,
	"current_scheduled_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_at_unknown" boolean DEFAULT false NOT NULL,
	"administering_encounter_id" bigint,
	"administered_by_id" bigint,
	"documented_by_id" bigint,
	"lot_id" bigint,
	"manufacturer_snapshot" text,
	"expiry_date_snapshot" date,
	"dose_volume_ml_actual" numeric(6, 2),
	"needle_gauge" text,
	"refusal_reason" text,
	"deferral_reason" text,
	"idempotency_key" text,
	"quantity" numeric(8, 2) DEFAULT '1' NOT NULL,
	"dose_number" integer,
	"administration_route" "administration_route",
	"administration_site" text,
	"indication" text,
	"notes" jsonb,
	"administered_at_external_clinic" boolean DEFAULT false NOT NULL,
	"external_clinician_name" text,
	"external_clinic_name" text,
	"external_notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "clinical_orders_display_id_unique" UNIQUE("display_id"),
	CONSTRAINT "clinical_orders_unknown_completion_check" CHECK (NOT "clinical_orders"."completed_at_unknown" OR ("clinical_orders"."status" = 'Completed' AND "clinical_orders"."completed_at" IS NULL AND "clinical_orders"."administered_at_external_clinic" = true))
);
--> statement-breakpoint
CREATE TABLE "clinical_orders_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"encounter_id" bigint,
	"consent_type" text NOT NULL,
	"scope" text NOT NULL,
	"scope_ref_type" text,
	"scope_ref_id" text,
	"consenter_relation" "consenter_relation" NOT NULL,
	"consenter_name" text,
	"vis_provided" boolean,
	"vis_version" text,
	"vis_date" date,
	"vis_language" text,
	"obtained_at" timestamp with time zone NOT NULL,
	"obtained_by_id" bigint,
	"consent_language" text,
	"signature_attachment_id" bigint,
	"witness_id" bigint,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "consents_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "cross_branch_access_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"source_branch_id" bigint,
	"target_branch_id" bigint NOT NULL,
	"patient_id" bigint NOT NULL,
	"reason_category" text NOT NULL,
	"reason_detail" text NOT NULL,
	"correlation_id" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cross_branch_access_grants_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "day_summary_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"snapshot_date" date NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_summary_snapshots_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"last_publish_error" text
);
--> statement-breakpoint
CREATE TABLE "encounter_diagnoses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"encounter_id" bigint NOT NULL,
	"patient_id" bigint NOT NULL,
	"icd10_code" text NOT NULL,
	"description" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"diagnosis_type" text,
	"recorded_by_id" bigint,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "encounter_vitals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"encounter_id" bigint NOT NULL,
	"patient_id" bigint NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by_id" bigint,
	"temperature_c" numeric(4, 1),
	"heart_rate_bpm" integer,
	"respiratory_rate_bpm" integer,
	"systolic_bp" integer,
	"diastolic_bp" integer,
	"spo2_percent" numeric(5, 2),
	"weight_kg" numeric(6, 2),
	"height_cm" numeric(5, 1),
	"bmi" numeric(5, 2),
	"pain_score" integer,
	"extra" jsonb,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"appointment_id" bigint,
	"provider_id" bigint,
	"closed_by_id" bigint,
	"specialty" "encounter_specialty" NOT NULL,
	"status" "encounter_status" DEFAULT 'Open' NOT NULL,
	"chief_complaint" text,
	"visit_no" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"disposition_code" text,
	"specialty_data" jsonb,
	"clinical_notes" jsonb,
	"row_version" integer DEFAULT 0 NOT NULL,
	"triage_category" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "encounters_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "encounters_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "feature_flags_tenant_id_branch_id_key_pk" PRIMARY KEY("tenant_id","branch_id","key")
);
--> statement-breakpoint
CREATE TABLE "inventory_lot_balances" (
	"lot_id" bigint PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"quantity_on_hand" numeric(12, 4) NOT NULL,
	"quantity_reserved" numeric(12, 4) DEFAULT '0' NOT NULL,
	"quantity_available" numeric(12, 4) NOT NULL,
	"last_movement_at" timestamp with time zone,
	"weighted_average_cost" numeric(12, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"batch_number" text NOT NULL,
	"manufacturer" text NOT NULL,
	"ndc_code_snapshot" text,
	"expiry_date" date NOT NULL,
	"quantity_on_hand" numeric(12, 4) NOT NULL,
	"quantity_received" numeric(12, 4) NOT NULL,
	"remaining_volume_ml" numeric(6, 2),
	"unit_cost" numeric(12, 4) NOT NULL,
	"cost_currency" text DEFAULT 'PHP' NOT NULL,
	"is_quarantined" boolean DEFAULT false NOT NULL,
	"quarantine_reason" text,
	"location_id" bigint,
	"recall_id" bigint,
	"supplier_name" text,
	"supplier_invoice_number" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "inventory_lots_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"lot_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"movement_type" "movement_type" NOT NULL,
	"quantity_delta" numeric(12, 4) NOT NULL,
	"unit_cost_snapshot" numeric(12, 4),
	"clinical_order_id" bigint,
	"inventory_adjustment_id" bigint,
	"inventory_transfer_id" bigint,
	"notes" text,
	"performed_by_id" bigint NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "inventory_movements_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"transfer_ref" text,
	"tenant_id" text NOT NULL,
	"source_branch_id" bigint NOT NULL,
	"destination_branch_id" bigint NOT NULL,
	"lot_id" bigint NOT NULL,
	"destination_lot_id" bigint,
	"quantity" numeric(12, 4) NOT NULL,
	"status" "inventory_transfer_status" DEFAULT 'PendingReceipt' NOT NULL,
	"shipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"shipped_by_id" bigint NOT NULL,
	"received_by_id" bigint,
	"cancelled_by_id" bigint,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfers_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "lab_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"clinical_order_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"laboratory_id" bigint,
	"status" "lab_order_status" DEFAULT 'Pending' NOT NULL,
	"external_order_id" text,
	"collected_at" timestamp with time zone,
	"collected_by_id" bigint,
	"rejection_reason" text,
	"has_critical_value" boolean DEFAULT false NOT NULL,
	"critical_value_acknowledged_at" timestamp with time zone,
	"critical_value_acknowledged_by_id" bigint,
	"result_data" jsonb,
	"result_file_attachment_id" bigint,
	"sent_at" timestamp with time zone,
	"result_received_at" timestamp with time zone,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "lab_orders_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "lab_orders_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location_type" text NOT NULL,
	"metadata" jsonb,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "migration"."canonical_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"canonical_event_key" text NOT NULL,
	"version_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"disposition" text NOT NULL,
	"facts" jsonb NOT NULL,
	"supersedes_event_id" bigint,
	"rule_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_events_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "canonical_events_version_hash_check" CHECK ("migration"."canonical_events"."version_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "canonical_events_disposition_check" CHECK ("migration"."canonical_events"."disposition" IN ('SafeWrite', 'Withhold', 'ManualReview', 'EvidenceOnly'))
);
--> statement-breakpoint
CREATE TABLE "migration"."decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"disposition" text NOT NULL,
	"reason_code" text NOT NULL,
	"rationale" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"decided_by_id" bigint NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "decisions_disposition_check" CHECK ("migration"."decisions"."disposition" IN ('Approved', 'Excluded', 'Rejected')),
	CONSTRAINT "decisions_payload_hash_check" CHECK ("migration"."decisions"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "migration"."event_evidence" (
	"tenant_id" text NOT NULL,
	"event_id" bigint NOT NULL,
	"observation_id" bigint NOT NULL,
	"evidence_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_evidence_tenant_id_event_id_observation_id_evidence_role_pk" PRIMARY KEY("tenant_id","event_id","observation_id","evidence_role"),
	CONSTRAINT "event_evidence_role_check" CHECK ("migration"."event_evidence"."evidence_role" IN ('Assertion', 'Support', 'Contradiction'))
);
--> statement-breakpoint
CREATE TABLE "migration"."exception_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"exception_id" text NOT NULL,
	"status" text NOT NULL,
	"decision_id" text,
	"owner_user_id" bigint,
	"note" text,
	"recorded_by_id" bigint,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_events_status_check" CHECK ("migration"."exception_events"."status" IN ('Open', 'Assigned', 'Resolved', 'Excluded', 'Reopened'))
);
--> statement-breakpoint
CREATE TABLE "migration"."exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"priority" text NOT NULL,
	"code" text NOT NULL,
	"subject_key" text NOT NULL,
	"summary" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exceptions_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "exceptions_priority_check" CHECK ("migration"."exceptions"."priority" IN ('P0', 'P1', 'P2', 'P3'))
);
--> statement-breakpoint
CREATE TABLE "migration"."observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"snapshot_id" bigint NOT NULL,
	"source_kind" text NOT NULL,
	"sheet_name" text,
	"row_number" integer,
	"source_row_id" text,
	"row_hash" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"secured_payload_ref" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observations_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "observations_row_number_check" CHECK ("migration"."observations"."row_number" IS NULL OR "migration"."observations"."row_number" > 0),
	CONSTRAINT "observations_row_locator_check" CHECK ("migration"."observations"."source_row_id" IS NOT NULL OR "migration"."observations"."row_number" IS NOT NULL),
	CONSTRAINT "observations_row_hash_check" CHECK ("migration"."observations"."row_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "observations_payload_hash_check" CHECK ("migration"."observations"."payload_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "migration"."run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb,
	"recorded_by_id" bigint,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_status_check" CHECK ("migration"."run_events"."status" IN ('Started', 'Validated', 'Applying', 'Completed', 'Failed', 'Abandoned'))
);
--> statement-breakpoint
CREATE TABLE "migration"."runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"mode" text NOT NULL,
	"source_pack_hash" text NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"importer_version" text NOT NULL,
	"parent_run_id" text,
	"created_by_id" bigint,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "runs_mode_check" CHECK ("migration"."runs"."mode" IN ('Rehearsal', 'Baseline', 'CatchUp', 'DeltaAudit')),
	CONSTRAINT "runs_source_pack_hash_check" CHECK ("migration"."runs"."source_pack_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "migration"."source_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"source_identity" text NOT NULL,
	"source_kind" text NOT NULL,
	"drive_file_id" text,
	"revision_id" text,
	"drive_modified_at" timestamp with time zone,
	"capture_started_at" timestamp with time zone NOT NULL,
	"capture_finished_at" timestamp with time zone NOT NULL,
	"export_sha256" text NOT NULL,
	"selected_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"header_fingerprint" text,
	"workbook_title" text,
	"workbook_branch_legacy_id" text,
	"row_count" integer,
	"secured_artifact_ref" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_snapshots_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "source_snapshots_hash_check" CHECK ("migration"."source_snapshots"."export_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "source_snapshots_row_count_check" CHECK ("migration"."source_snapshots"."row_count" IS NULL OR "migration"."source_snapshots"."row_count" >= 0),
	CONSTRAINT "source_snapshots_capture_order_check" CHECK ("migration"."source_snapshots"."capture_finished_at" >= "migration"."source_snapshots"."capture_started_at")
);
--> statement-breakpoint
CREATE TABLE "migration"."sync_checkpoints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source_identity" text NOT NULL,
	"run_id" text NOT NULL,
	"source_pack_hash" text NOT NULL,
	"last_snapshot_id" bigint NOT NULL,
	"applicable_event_count" integer NOT NULL,
	"applied_event_count" integer NOT NULL,
	"exception_count" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_checkpoints_hash_check" CHECK ("migration"."sync_checkpoints"."source_pack_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sync_checkpoints_applicable_count_check" CHECK ("migration"."sync_checkpoints"."applicable_event_count" >= 0),
	CONSTRAINT "sync_checkpoints_applied_count_check" CHECK ("migration"."sync_checkpoints"."applied_event_count" >= 0),
	CONSTRAINT "sync_checkpoints_exception_count_check" CHECK ("migration"."sync_checkpoints"."exception_count" >= 0),
	CONSTRAINT "sync_checkpoints_applied_lte_applicable_check" CHECK ("migration"."sync_checkpoints"."applied_event_count" <= "migration"."sync_checkpoints"."applicable_event_count")
);
--> statement-breakpoint
CREATE TABLE "migration"."target_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_id" bigint NOT NULL,
	"target_table" text NOT NULL,
	"target_display_id" text NOT NULL,
	"mutation_kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_links_mutation_kind_check" CHECK ("migration"."target_links"."mutation_kind" IN ('Insert', 'EvidenceOnly', 'Correction', 'VoidReplacement'))
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "notification_templates_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"template_id" bigint,
	"patient_id" bigint,
	"user_id" bigint,
	"channel" "notification_channel" NOT NULL,
	"recipient_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "notification_status" DEFAULT 'Queued' NOT NULL,
	"entity_type" text,
	"entity_id" bigint,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"external_message_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"consent_verified_at" timestamp with time zone,
	"metadata" jsonb,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "partner_laboratories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_number" text,
	"email" text,
	"address" text,
	"api_config" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "partner_laboratories_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_from_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_allergies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"allergen" text NOT NULL,
	"allergen_code" text,
	"reaction" text,
	"severity" text,
	"onset_date" date,
	"source" text NOT NULL,
	"recorded_by_id" bigint,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "patient_conditions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"condition_name" text NOT NULL,
	"icd10_code" text,
	"status" text NOT NULL,
	"onset_date" date,
	"resolved_date" date,
	"recorded_by_id" bigint,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "patient_emergency_contacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone_number" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "patient_external_immunizations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"patient_standing_order_id" bigint,
	"service_id" text,
	"vaccine_name" text NOT NULL,
	"cvx_code" text,
	"manufacturer" text,
	"lot_number" text,
	"administered_date" date,
	"administered_date_precision" "external_immunization_date_precision" DEFAULT 'Exact' NOT NULL,
	"administered_at_facility" text,
	"dose_number_in_series" integer,
	"source" text NOT NULL,
	"verified_by_id" bigint,
	"verified_at" timestamp with time zone,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "patient_ext_imm_date_precision_check" CHECK ("patient_external_immunizations"."administered_date_precision" IN ('Exact', 'Estimated', 'Unknown')),
	CONSTRAINT "patient_ext_imm_date_presence_check" CHECK (("patient_external_immunizations"."administered_date_precision" = 'Unknown' AND "patient_external_immunizations"."administered_date" IS NULL) OR ("patient_external_immunizations"."administered_date_precision" IN ('Exact', 'Estimated') AND "patient_external_immunizations"."administered_date" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "patient_standing_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"template_id" text NOT NULL,
	"initiating_encounter_id" bigint,
	"authorizing_provider_id" bigint,
	"status" "standing_order_status" DEFAULT 'Active' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_by_id" bigint,
	"suspension_reason" text,
	"resumed_at" timestamp with time zone,
	"discontinued_at" timestamp with time zone,
	"discontinued_by_id" bigint,
	"discontinuation_reason" text,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "patient_standing_orders_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "patient_standing_orders_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "patient_tags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"patient_id" bigint NOT NULL,
	"tag_definition_id" bigint NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by_id" bigint,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"mrn" text NOT NULL,
	"home_branch_id" bigint,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"middle_name" text,
	"suffix" text,
	"date_of_birth" date,
	"sex" "sex",
	"civil_status" text,
	"nationality" text,
	"address" text,
	"region" text,
	"province" text,
	"city" text,
	"barangay" text,
	"contact_number" text,
	"email" "citext",
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"sms_opt_in" boolean DEFAULT false NOT NULL,
	"email_opt_in" boolean DEFAULT false NOT NULL,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_contact" text,
	"insurance_provider" text,
	"insurance_policy_number" text,
	"onboarding_data" jsonb,
	"onboarding_channel" text,
	"onboarding_channel_payer_id" bigint,
	"health_card_attachment_id" bigint,
	"potential_duplicate_of_id" bigint,
	"merged_into_id" bigint,
	"merged_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"scheduled_purge_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_vector" "tsvector",
	"full_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "patients_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "payer_contracts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"payer_id" bigint NOT NULL,
	"contract_number" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"payment_terms_days" integer,
	"claim_submission_format" text,
	"requires_prior_auth" boolean DEFAULT false NOT NULL,
	"fee_schedule_notes" text,
	"contact_name" text,
	"contact_number" text,
	"contact_email" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "payer_contracts_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "payer_price_adjustment_exclusions" (
	"tenant_id" text NOT NULL,
	"payer_id" bigint NOT NULL,
	"service_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "payer_price_adjustment_exclusions_tenant_id_payer_id_service_id_pk" PRIMARY KEY("tenant_id","payer_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "payer_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"payer_type" "payer_type" NOT NULL,
	"contact_name" text,
	"contact_number" text,
	"email" text,
	"address" text,
	"payment_terms_days" integer,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"price_adjustment_percent" numeric(5, 2),
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "payer_profiles_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"transaction_id" bigint NOT NULL,
	"cash_drawer_session_id" bigint,
	"funded_by_transaction_id" bigint,
	"method" "payment_method" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payer_id" bigint,
	"reference_number" text,
	"external_processor_fee" numeric(12, 2),
	"reconciliation_status" text DEFAULT 'Pending' NOT NULL,
	"cleared_at" timestamp with time zone,
	"idempotency_key" text,
	"received_by_id" bigint,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"voided_at" timestamp with time zone,
	"voided_by_id" bigint,
	"void_reason" text,
	"replaced_by_payment_id" bigint,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "payments_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "phi_access_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"session_id" bigint,
	"patient_id" bigint,
	"access_type" text NOT NULL,
	"access_reason" text,
	"is_break_glass" boolean DEFAULT false NOT NULL,
	"context_entity_type" text,
	"context_entity_id" text,
	"ip_address" text,
	"user_agent" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pin_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"can_login" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" text,
	"mfa_enrolled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "product_recalls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" bigint,
	"recall_no" text,
	"manufacturer" text,
	"affected_lots_pattern" text,
	"recall_reason" text NOT NULL,
	"recall_severity" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"patient_notification_required" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "product_recalls_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text,
	"ndc_code" text,
	"default_route" "administration_route",
	"vial_volume_ml" numeric(6, 2),
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "products_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"jti" text NOT NULL,
	"family_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
CREATE TABLE "service_bundle_items" (
	"tenant_id" text NOT NULL,
	"bundle_service_id" text NOT NULL,
	"item_service_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "service_bundle_items_tenant_id_bundle_service_id_item_service_id_pk" PRIMARY KEY("tenant_id","bundle_service_id","item_service_id")
);
--> statement-breakpoint
CREATE TABLE "service_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"service_type" "service_type" NOT NULL,
	"category_id" bigint,
	"product_id" bigint,
	"cvx_code" text,
	"ndc_code" text,
	"cpt_code" text,
	"loinc_code" text,
	"default_route" "administration_route",
	"default_dose_volume_ml" numeric(6, 2),
	"default_manufacturer" text,
	"is_vat_exempt" boolean DEFAULT false NOT NULL,
	"requires_stock" boolean DEFAULT false NOT NULL,
	"requires_rx" boolean DEFAULT false NOT NULL,
	"requires_consent" boolean DEFAULT false NOT NULL,
	"requires_vis" boolean DEFAULT false NOT NULL,
	"requires_dose_calculation" boolean DEFAULT false NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "service_categories_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "service_eligible_products" (
	"tenant_id" text NOT NULL,
	"service_id" text NOT NULL,
	"product_id" bigint NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"ranking" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_eligible_products_tenant_id_service_id_product_id_pk" PRIMARY KEY("tenant_id","service_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "service_prices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"service_id" text NOT NULL,
	"branch_id" bigint,
	"payer_id" bigint,
	"product_id" bigint,
	"patient_segment" text,
	"unit_price" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'PHP' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "service_prices_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "staff_time_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"total_hours" numeric(6, 2),
	"notes" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "staff_time_logs_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "standing_order_template_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"template_id" text NOT NULL,
	"service_id" text NOT NULL,
	"day_offset" integer NOT NULL,
	"sequence" integer NOT NULL,
	"quantity" numeric(8, 2) DEFAULT '1' NOT NULL,
	"instructions" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_order_template_items_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "standing_order_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"requires_physician_auth" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" text,
	"superseded_by_id" text,
	"is_locked" boolean DEFAULT false NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"specialty" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "tag_definitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"tag" text NOT NULL,
	"description" text,
	"color" text,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" date DEFAULT CURRENT_DATE NOT NULL,
	"effective_to" date,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "tag_definitions_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_counters" (
	"tenant_id" text NOT NULL,
	"branch_id" bigint,
	"counter_kind" text NOT NULL,
	"current_value" bigint DEFAULT 0 NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"country_code" text DEFAULT 'PH' NOT NULL,
	"retention_policy" jsonb,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "transaction_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"transaction_id" bigint NOT NULL,
	"service_id" text NOT NULL,
	"clinical_order_id" bigint,
	"patient_id" bigint,
	"lot_id" bigint,
	"quantity" numeric(8, 2) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"unit_cost_snapshot" numeric(12, 4),
	"service_price_id" bigint,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_vat_exempt" boolean DEFAULT false NOT NULL,
	"vat_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"is_prepaid" boolean DEFAULT false NOT NULL,
	"prepaid_transaction_id" bigint,
	"performed_by_id" bigint,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "transaction_items_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_patients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"transaction_id" bigint NOT NULL,
	"patient_id" bigint NOT NULL,
	"encounter_id" bigint,
	"discount_id_type" "discount_id_type",
	"discount_id_number" text,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"patient_id" bigint NOT NULL,
	"encounter_id" bigint,
	"cashier_id" bigint,
	"cash_drawer_session_id" bigint,
	"payer_id" bigint,
	"payer_contract_id" bigint,
	"status" "transaction_status" DEFAULT 'Draft' NOT NULL,
	"receipt_no" text,
	"or_series_id" text,
	"branch_seq" integer,
	"discount_id_type" "discount_id_type",
	"discount_id_number" text,
	"gross_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 4) DEFAULT '0.12' NOT NULL,
	"net_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_outstanding" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_prepayment" boolean DEFAULT false NOT NULL,
	"applied_to_transaction_id" bigint,
	"prepayment_applied_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by_id" bigint,
	"void_reason" text,
	"replacement_transaction_id" bigint,
	"refunded_from_transaction_id" bigint,
	"idempotency_key" text,
	"transacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "transactions_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
CREATE TABLE "transactions_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_id" bigint,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "user_branches" (
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"branch_id" bigint NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_id" bigint,
	CONSTRAINT "user_branches_user_id_branch_id_pk" PRIMARY KEY("user_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"role" "user_role" NOT NULL,
	"branch_id" bigint,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_id" bigint,
	"expires_at" timestamp with time zone,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"device_fingerprint" text,
	"device_label" text,
	"ip_address" text,
	"user_agent" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"pin_hash" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"license_number" text,
	"license_type" text,
	"license_expires_at" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"can_login" boolean DEFAULT true NOT NULL,
	"preferred_name" text,
	"status" "user_status" DEFAULT 'Active' NOT NULL,
	"primary_branch_id" bigint,
	"password_changed_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_encrypted" text,
	"last_login_at" timestamp with time zone,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" bigint,
	CONSTRAINT "users_display_id_unique" UNIQUE("display_id")
);
--> statement-breakpoint
ALTER TABLE "adverse_events" ADD CONSTRAINT "adverse_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_events" ADD CONSTRAINT "adverse_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adverse_events" ADD CONSTRAINT "adverse_events_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_observation_followups" ADD CONSTRAINT "animal_observation_followups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_observation_followups" ADD CONSTRAINT "animal_observation_followups_bite_incident_id_bite_incidents_id_fk" FOREIGN KEY ("bite_incident_id") REFERENCES "public"."bite_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "animal_observation_followups" ADD CONSTRAINT "animal_observation_followups_outcome_recorded_by_id_users_id_fk" FOREIGN KEY ("outcome_recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_incidents" ADD CONSTRAINT "bite_incidents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_incidents" ADD CONSTRAINT "bite_incidents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_incidents" ADD CONSTRAINT "bite_incidents_patient_standing_order_id_patient_standing_orders_id_fk" FOREIGN KEY ("patient_standing_order_id") REFERENCES "public"."patient_standing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bite_incidents" ADD CONSTRAINT "bite_incidents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_cash_drawer_session_id_cash_drawer_sessions_id_fk" FOREIGN KEY ("cash_drawer_session_id") REFERENCES "public"."cash_drawer_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_sessions" ADD CONSTRAINT "cash_drawer_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_sessions" ADD CONSTRAINT "cash_drawer_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_sessions" ADD CONSTRAINT "cash_drawer_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_items" ADD CONSTRAINT "claim_items_transaction_item_id_transaction_items_id_fk" FOREIGN KEY ("transaction_item_id") REFERENCES "public"."transaction_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_payer_id_payer_profiles_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_order_schedule_changes" ADD CONSTRAINT "clinical_order_schedule_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_order_schedule_changes" ADD CONSTRAINT "clinical_order_schedule_changes_clinical_order_id_clinical_orders_id_fk" FOREIGN KEY ("clinical_order_id") REFERENCES "public"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_patient_standing_order_id_patient_standing_orders_id_fk" FOREIGN KEY ("patient_standing_order_id") REFERENCES "public"."patient_standing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_fan_out_transaction_id_transactions_id_fk" FOREIGN KEY ("fan_out_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_service_id_service_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_orders" ADD CONSTRAINT "clinical_orders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_branch_access_grants" ADD CONSTRAINT "cross_branch_access_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_branch_access_grants" ADD CONSTRAINT "cross_branch_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_branch_access_grants" ADD CONSTRAINT "cross_branch_access_grants_source_branch_id_branches_id_fk" FOREIGN KEY ("source_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_branch_access_grants" ADD CONSTRAINT "cross_branch_access_grants_target_branch_id_branches_id_fk" FOREIGN KEY ("target_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_branch_access_grants" ADD CONSTRAINT "cross_branch_access_grants_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_summary_snapshots" ADD CONSTRAINT "day_summary_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_summary_snapshots" ADD CONSTRAINT "day_summary_snapshots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_summary_snapshots" ADD CONSTRAINT "day_summary_snapshots_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_diagnoses" ADD CONSTRAINT "encounter_diagnoses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_diagnoses" ADD CONSTRAINT "encounter_diagnoses_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_diagnoses" ADD CONSTRAINT "encounter_diagnoses_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_vitals" ADD CONSTRAINT "encounter_vitals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_vitals" ADD CONSTRAINT "encounter_vitals_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_vitals" ADD CONSTRAINT "encounter_vitals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_provider_id_users_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_balances" ADD CONSTRAINT "inventory_lot_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_source_branch_id_branches_id_fk" FOREIGN KEY ("source_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_branch_id_branches_id_fk" FOREIGN KEY ("destination_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_lot_id_inventory_lots_id_fk" FOREIGN KEY ("destination_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_shipped_by_id_users_id_fk" FOREIGN KEY ("shipped_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_clinical_order_id_clinical_orders_id_fk" FOREIGN KEY ("clinical_order_id") REFERENCES "public"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_laboratory_id_partner_laboratories_id_fk" FOREIGN KEY ("laboratory_id") REFERENCES "public"."partner_laboratories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_result_file_attachment_id_attachments_id_fk" FOREIGN KEY ("result_file_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."canonical_events" ADD CONSTRAINT "canonical_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."canonical_events" ADD CONSTRAINT "canonical_events_supersedes_event_id_canonical_events_id_fk" FOREIGN KEY ("supersedes_event_id") REFERENCES "migration"."canonical_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."canonical_events" ADD CONSTRAINT "canonical_events_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "migration"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."decisions" ADD CONSTRAINT "decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."decisions" ADD CONSTRAINT "decisions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."decisions" ADD CONSTRAINT "decisions_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "migration"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."event_evidence" ADD CONSTRAINT "event_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."event_evidence" ADD CONSTRAINT "event_evidence_tenant_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "migration"."canonical_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."event_evidence" ADD CONSTRAINT "event_evidence_tenant_observation_fk" FOREIGN KEY ("tenant_id","observation_id") REFERENCES "migration"."observations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."exception_events" ADD CONSTRAINT "exception_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."exception_events" ADD CONSTRAINT "exception_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."exception_events" ADD CONSTRAINT "exception_events_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."exception_events" ADD CONSTRAINT "exception_events_tenant_exception_fk" FOREIGN KEY ("tenant_id","exception_id") REFERENCES "migration"."exceptions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."exception_events" ADD CONSTRAINT "exception_events_tenant_decision_fk" FOREIGN KEY ("tenant_id","decision_id") REFERENCES "migration"."decisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."exceptions" ADD CONSTRAINT "exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."exceptions" ADD CONSTRAINT "exceptions_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "migration"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."observations" ADD CONSTRAINT "observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."observations" ADD CONSTRAINT "observations_tenant_snapshot_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "migration"."source_snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."run_events" ADD CONSTRAINT "run_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."run_events" ADD CONSTRAINT "run_events_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."run_events" ADD CONSTRAINT "run_events_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "migration"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."runs" ADD CONSTRAINT "runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."runs" ADD CONSTRAINT "runs_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "migration"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."runs" ADD CONSTRAINT "runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."source_snapshots" ADD CONSTRAINT "source_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."source_snapshots" ADD CONSTRAINT "source_snapshots_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "migration"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "migration"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_tenant_snapshot_fk" FOREIGN KEY ("tenant_id","last_snapshot_id") REFERENCES "migration"."source_snapshots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."target_links" ADD CONSTRAINT "target_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration"."target_links" ADD CONSTRAINT "target_links_tenant_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "migration"."canonical_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_laboratories" ADD CONSTRAINT "partner_laboratories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_laboratories" ADD CONSTRAINT "partner_laboratories_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_conditions" ADD CONSTRAINT "patient_conditions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_emergency_contacts" ADD CONSTRAINT "patient_emergency_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_emergency_contacts" ADD CONSTRAINT "patient_emergency_contacts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_external_immunizations" ADD CONSTRAINT "patient_external_immunizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_external_immunizations" ADD CONSTRAINT "patient_external_immunizations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_external_immunizations" ADD CONSTRAINT "patient_external_immunizations_patient_standing_order_id_patient_standing_orders_id_fk" FOREIGN KEY ("patient_standing_order_id") REFERENCES "public"."patient_standing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_external_immunizations" ADD CONSTRAINT "patient_external_immunizations_service_id_service_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_standing_orders" ADD CONSTRAINT "patient_standing_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_standing_orders" ADD CONSTRAINT "patient_standing_orders_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_standing_orders" ADD CONSTRAINT "patient_standing_orders_template_id_standing_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."standing_order_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_standing_orders" ADD CONSTRAINT "patient_standing_orders_initiating_encounter_id_encounters_id_fk" FOREIGN KEY ("initiating_encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_standing_orders" ADD CONSTRAINT "patient_standing_orders_authorizing_provider_id_users_id_fk" FOREIGN KEY ("authorizing_provider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_standing_orders" ADD CONSTRAINT "patient_standing_orders_discontinued_by_id_users_id_fk" FOREIGN KEY ("discontinued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_standing_orders" ADD CONSTRAINT "patient_standing_orders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tags" ADD CONSTRAINT "patient_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tags" ADD CONSTRAINT "patient_tags_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tags" ADD CONSTRAINT "patient_tags_tag_definition_id_tag_definitions_id_fk" FOREIGN KEY ("tag_definition_id") REFERENCES "public"."tag_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_tags" ADD CONSTRAINT "patient_tags_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_home_branch_id_branches_id_fk" FOREIGN KEY ("home_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_onboarding_channel_payer_id_payer_profiles_id_fk" FOREIGN KEY ("onboarding_channel_payer_id") REFERENCES "public"."payer_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_contracts" ADD CONSTRAINT "payer_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_contracts" ADD CONSTRAINT "payer_contracts_payer_id_payer_profiles_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_price_adjustment_exclusions" ADD CONSTRAINT "payer_price_adjustment_exclusions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_price_adjustment_exclusions" ADD CONSTRAINT "payer_price_adjustment_exclusions_payer_id_payer_profiles_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_price_adjustment_exclusions" ADD CONSTRAINT "payer_price_adjustment_exclusions_service_id_service_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_profiles" ADD CONSTRAINT "payer_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_profiles" ADD CONSTRAINT "payer_profiles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_funded_by_transaction_id_transactions_id_fk" FOREIGN KEY ("funded_by_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_id_payer_profiles_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_users_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_replaced_by_payment_id_payments_id_fk" FOREIGN KEY ("replaced_by_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recalls" ADD CONSTRAINT "product_recalls_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bundle_items" ADD CONSTRAINT "service_bundle_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bundle_items" ADD CONSTRAINT "service_bundle_items_bundle_service_id_service_catalog_id_fk" FOREIGN KEY ("bundle_service_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bundle_items" ADD CONSTRAINT "service_bundle_items_item_service_id_service_catalog_id_fk" FOREIGN KEY ("item_service_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_eligible_products" ADD CONSTRAINT "service_eligible_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_eligible_products" ADD CONSTRAINT "service_eligible_products_service_id_service_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_eligible_products" ADD CONSTRAINT "service_eligible_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_service_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_logs" ADD CONSTRAINT "staff_time_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_logs" ADD CONSTRAINT "staff_time_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_logs" ADD CONSTRAINT "staff_time_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_logs" ADD CONSTRAINT "staff_time_logs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order_template_items" ADD CONSTRAINT "standing_order_template_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order_template_items" ADD CONSTRAINT "standing_order_template_items_template_id_standing_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."standing_order_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order_template_items" ADD CONSTRAINT "standing_order_template_items_service_id_service_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order_templates" ADD CONSTRAINT "standing_order_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_order_templates" ADD CONSTRAINT "standing_order_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_definitions" ADD CONSTRAINT "tag_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_counters" ADD CONSTRAINT "tenant_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_service_id_service_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_clinical_order_id_clinical_orders_id_fk" FOREIGN KEY ("clinical_order_id") REFERENCES "public"."clinical_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_prepaid_transaction_id_transactions_id_fk" FOREIGN KEY ("prepaid_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_patients" ADD CONSTRAINT "transaction_patients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_patients" ADD CONSTRAINT "transaction_patients_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_patients" ADD CONSTRAINT "transaction_patients_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_patients" ADD CONSTRAINT "transaction_patients_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_patients" ADD CONSTRAINT "transaction_patients_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payer_id_payer_profiles_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adverse_events_patient_idx" ON "adverse_events" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "adverse_events_tenant_created_idx" ON "adverse_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "adverse_events_tenant_id_uniq" ON "adverse_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "animal_followups_tenant_due_idx" ON "animal_observation_followups" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "animal_followups_tenant_id_uniq" ON "animal_observation_followups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "animal_followups_incident_uniq" ON "animal_observation_followups" USING btree ("tenant_id","bite_incident_id");--> statement-breakpoint
CREATE INDEX "appointments_branch_time_idx" ON "appointments" USING btree ("tenant_id","branch_id","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("tenant_id","patient_id","scheduled_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_tenant_id_uniq" ON "appointments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "appointments_tenant_status_active_idx" ON "appointments" USING btree ("tenant_id","status","scheduled_start_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "appt_status_history_entity_idx" ON "appointments_status_history" USING btree ("tenant_id","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "approval_decisions_request_idx" ON "approval_decisions" USING btree ("approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_request_decider_uniq" ON "approval_decisions" USING btree ("approval_request_id","decided_by_id");--> statement-breakpoint
CREATE INDEX "approval_requests_tenant_status_idx" ON "approval_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "approval_requests_tenant_branch_idx" ON "approval_requests" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_tenant_id_uniq" ON "approval_requests" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_tenant_id_uniq" ON "attachments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_user_idx" ON "audit_logs" USING btree ("tenant_id","user_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "bite_incidents_tenant_patient_idx" ON "bite_incidents" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "bite_incidents_tenant_created_idx" ON "bite_incidents" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bite_incidents_tenant_id_uniq" ON "bite_incidents" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_tenant_code_idx" ON "branches" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_tenant_id_uniq" ON "branches" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "cash_deposits_session_idx" ON "cash_deposits" USING btree ("tenant_id","cash_drawer_session_id");--> statement-breakpoint
CREATE INDEX "cash_deposits_branch_idx" ON "cash_deposits" USING btree ("tenant_id","branch_id","deposited_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_deposits_tenant_id_uniq" ON "cash_deposits" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "cash_drawer_sessions_tenant_branch_idx" ON "cash_drawer_sessions" USING btree ("tenant_id","branch_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_drawer_sessions_tenant_id_uniq" ON "cash_drawer_sessions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "claim_items_claim_idx" ON "claim_items" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_items_tenant_id_uniq" ON "claim_items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_tenant_claim_no_uniq" ON "claims" USING btree ("tenant_id","claim_no");--> statement-breakpoint
CREATE INDEX "claims_payer_status_idx" ON "claims" USING btree ("tenant_id","payer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_tenant_id_uniq" ON "claims" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "claims_tenant_status_active_idx" ON "claims" USING btree ("tenant_id","status","submitted_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "claims_status_history_entity_idx" ON "claims_status_history" USING btree ("tenant_id","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "co_schedule_changes_order_idx" ON "clinical_order_schedule_changes" USING btree ("clinical_order_id","changed_at");--> statement-breakpoint
CREATE INDEX "clinical_orders_scheduled_idx" ON "clinical_orders" USING btree ("tenant_id","patient_standing_order_id","status","current_scheduled_date");--> statement-breakpoint
CREATE INDEX "clinical_orders_tenant_so_idx" ON "clinical_orders" USING btree ("tenant_id","patient_standing_order_id");--> statement-breakpoint
CREATE INDEX "clinical_orders_tenant_encounter_idx" ON "clinical_orders" USING btree ("tenant_id","encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_orders_tenant_id_uniq" ON "clinical_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "clinical_orders_tenant_status_active_idx" ON "clinical_orders" USING btree ("tenant_id","status","current_scheduled_date") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "clinical_orders_fan_out_txn_idx" ON "clinical_orders" USING btree ("fan_out_transaction_id") WHERE fan_out_transaction_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "co_status_history_entity_idx" ON "clinical_orders_status_history" USING btree ("tenant_id","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "consents_patient_idx" ON "consents" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "consents_scope_ref_idx" ON "consents" USING btree ("scope_ref_type","scope_ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_tenant_id_uniq" ON "consents" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "cba_grants_patient_idx" ON "cross_branch_access_grants" USING btree ("patient_id","granted_at");--> statement-breakpoint
CREATE INDEX "cba_grants_user_idx" ON "cross_branch_access_grants" USING btree ("user_id","granted_at");--> statement-breakpoint
CREATE INDEX "cba_grants_tenant_idx" ON "cross_branch_access_grants" USING btree ("tenant_id","granted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cba_grants_tenant_branch_patient_uniq" ON "cross_branch_access_grants" USING btree ("tenant_id","target_branch_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "day_summary_snapshots_tenant_branch_date_idx" ON "day_summary_snapshots" USING btree ("tenant_id","branch_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "domain_events_unpublished_idx" ON "domain_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_aggregate_idx" ON "domain_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "encounter_diagnoses_encounter_idx" ON "encounter_diagnoses" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "encounter_diagnoses_icd10_idx" ON "encounter_diagnoses" USING btree ("tenant_id","icd10_code");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_diagnoses_tenant_id_uniq" ON "encounter_diagnoses" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "encounter_vitals_patient_time_idx" ON "encounter_vitals" USING btree ("tenant_id","patient_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_vitals_tenant_id_uniq" ON "encounter_vitals" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "encounters_tenant_patient_idx" ON "encounters" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "encounters_tenant_branch_idx" ON "encounters" USING btree ("tenant_id","branch_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_tenant_id_uniq" ON "encounters" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "encounters_tenant_status_active_idx" ON "encounters" USING btree ("tenant_id","status","started_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "encounters_status_history_entity_idx" ON "encounters_status_history" USING btree ("tenant_id","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_inventory_lots_fefo" ON "inventory_lots" USING btree ("product_id","branch_id","expiry_date","quantity_on_hand");--> statement-breakpoint
CREATE INDEX "inventory_lots_tenant_branch_idx" ON "inventory_lots" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lots_batch_idx" ON "inventory_lots" USING btree ("tenant_id","branch_id","product_id","batch_number");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lots_tenant_id_uniq" ON "inventory_lots" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "inventory_movements_lot_time_idx" ON "inventory_movements" USING btree ("tenant_id","lot_id","performed_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_clinical_idx" ON "inventory_movements" USING btree ("clinical_order_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_branch_idx" ON "inventory_movements" USING btree ("tenant_id","branch_id","performed_at");--> statement-breakpoint
CREATE INDEX "inv_transfers_tenant_status_idx" ON "inventory_transfers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inv_transfers_destination_idx" ON "inventory_transfers" USING btree ("tenant_id","destination_branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_transfers_tenant_id_uniq" ON "inventory_transfers" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "lab_orders_clinical_order_idx" ON "lab_orders" USING btree ("clinical_order_id");--> statement-breakpoint
CREATE INDEX "lab_orders_tenant_status_idx" ON "lab_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "lab_orders_tenant_branch_idx" ON "lab_orders" USING btree ("tenant_id","branch_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_orders_tenant_id_uniq" ON "lab_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "lab_orders_status_history_entity_idx" ON "lab_orders_status_history" USING btree ("tenant_id","entity_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_branch_code_uniq" ON "locations" USING btree ("branch_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_tenant_id_uniq" ON "locations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_events_version_hash_uniq" ON "migration"."canonical_events" USING btree ("tenant_id","version_hash");--> statement-breakpoint
CREATE INDEX "canonical_events_key_created_idx" ON "migration"."canonical_events" USING btree ("tenant_id","canonical_event_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_payload_hash_uniq" ON "migration"."decisions" USING btree ("tenant_id","payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "exception_events_tenant_id_uniq" ON "migration"."exception_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "exception_events_latest_idx" ON "migration"."exception_events" USING btree ("tenant_id","exception_id","recorded_at");--> statement-breakpoint
CREATE INDEX "exceptions_run_priority_idx" ON "migration"."exceptions" USING btree ("tenant_id","run_id","priority","code");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_version_uniq" ON "migration"."observations" USING btree ("tenant_id","snapshot_id","source_kind","sheet_name","source_row_id","row_number","row_hash");--> statement-breakpoint
CREATE INDEX "observations_snapshot_row_idx" ON "migration"."observations" USING btree ("tenant_id","snapshot_id","sheet_name","row_number");--> statement-breakpoint
CREATE INDEX "observations_row_hash_idx" ON "migration"."observations" USING btree ("tenant_id","row_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_tenant_id_uniq" ON "migration"."run_events" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "run_events_run_recorded_idx" ON "migration"."run_events" USING btree ("tenant_id","run_id","recorded_at");--> statement-breakpoint
CREATE INDEX "runs_tenant_created_idx" ON "migration"."runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_frozen_pack_identity_uniq" ON "migration"."runs" USING btree ("tenant_id","mode","source_pack_hash","cutoff_at","importer_version");--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshots_run_source_hash_uniq" ON "migration"."source_snapshots" USING btree ("tenant_id","run_id","source_identity","export_sha256");--> statement-breakpoint
CREATE INDEX "source_snapshots_source_capture_idx" ON "migration"."source_snapshots" USING btree ("tenant_id","source_identity","capture_finished_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_checkpoints_tenant_id_uniq" ON "migration"."sync_checkpoints" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_checkpoints_source_pack_uniq" ON "migration"."sync_checkpoints" USING btree ("tenant_id","source_identity","source_pack_hash");--> statement-breakpoint
CREATE INDEX "sync_checkpoints_latest_idx" ON "migration"."sync_checkpoints" USING btree ("tenant_id","source_identity","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "target_links_tenant_id_uniq" ON "migration"."target_links" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "target_links_idempotency_uniq" ON "migration"."target_links" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "target_links_event_target_uniq" ON "migration"."target_links" USING btree ("tenant_id","event_id","target_table","target_display_id","mutation_kind");--> statement-breakpoint
CREATE INDEX "target_links_target_idx" ON "migration"."target_links" USING btree ("tenant_id","target_table","target_display_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_tenant_code_lang_uniq" ON "notification_templates" USING btree ("tenant_id","code","channel","language");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_tenant_id_uniq" ON "notification_templates" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_status_idx" ON "notifications" USING btree ("tenant_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "notifications_patient_idx" ON "notifications" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_id_uniq" ON "notifications" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "partner_labs_tenant_idx" ON "partner_laboratories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_labs_tenant_id_uniq" ON "partner_laboratories" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_uniq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "patient_allergies_patient_idx" ON "patient_allergies" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "patient_allergies_tenant_created_idx" ON "patient_allergies" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_allergies_tenant_id_uniq" ON "patient_allergies" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "patient_conditions_patient_idx" ON "patient_conditions" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "patient_conditions_tenant_created_idx" ON "patient_conditions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_conditions_tenant_id_uniq" ON "patient_conditions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "patient_emergency_contacts_patient_idx" ON "patient_emergency_contacts" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "patient_emergency_contacts_tenant_created_idx" ON "patient_emergency_contacts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_emergency_contacts_tenant_id_uniq" ON "patient_emergency_contacts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "patient_ext_imm_patient_idx" ON "patient_external_immunizations" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "patient_ext_imm_course_idx" ON "patient_external_immunizations" USING btree ("tenant_id","patient_standing_order_id","dose_number_in_series");--> statement-breakpoint
CREATE INDEX "patient_ext_imm_tenant_created_idx" ON "patient_external_immunizations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_ext_imm_tenant_id_uniq" ON "patient_external_immunizations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_ext_imm_course_slot_uniq" ON "patient_external_immunizations" USING btree ("tenant_id","patient_standing_order_id","service_id","dose_number_in_series") WHERE "patient_external_immunizations"."patient_standing_order_id" IS NOT NULL AND "patient_external_immunizations"."service_id" IS NOT NULL AND "patient_external_immunizations"."dose_number_in_series" IS NOT NULL AND "patient_external_immunizations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pso_tenant_patient_idx" ON "patient_standing_orders" USING btree ("tenant_id","patient_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pso_tenant_id_uniq" ON "patient_standing_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "pso_status_history_entity_idx" ON "patient_standing_orders_status_history" USING btree ("tenant_id","entity_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_tags_patient_def_idx" ON "patient_tags" USING btree ("patient_id","tag_definition_id");--> statement-breakpoint
CREATE INDEX "patient_tags_tenant_def_idx" ON "patient_tags" USING btree ("tenant_id","tag_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_tags_tenant_id_uniq" ON "patient_tags" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "patients_tenant_idx" ON "patients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "patients_search_idx" ON "patients" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "patients_tenant_lastname_idx" ON "patients" USING btree ("tenant_id","last_name");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_tenant_id_uniq" ON "patients" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_tenant_mrn_uniq" ON "patients" USING btree ("tenant_id","mrn");--> statement-breakpoint
CREATE INDEX "payer_contracts_payer_idx" ON "payer_contracts" USING btree ("tenant_id","payer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payer_contracts_tenant_id_uniq" ON "payer_contracts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "payer_price_adjustment_exclusions_payer_idx" ON "payer_price_adjustment_exclusions" USING btree ("tenant_id","payer_id");--> statement-breakpoint
CREATE INDEX "payer_profiles_tenant_idx" ON "payer_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payer_profiles_tenant_id_uniq" ON "payer_profiles" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "payments_transaction_idx" ON "payments" USING btree ("tenant_id","transaction_id");--> statement-breakpoint
CREATE INDEX "payments_funded_by_idx" ON "payments" USING btree ("tenant_id","funded_by_transaction_id") WHERE "payments"."funded_by_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_id_uniq" ON "payments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "payments_active_idx" ON "payments" USING btree ("tenant_id","transaction_id") WHERE voided_at IS NULL;--> statement-breakpoint
CREATE INDEX "phi_access_user_time_idx" ON "phi_access_log" USING btree ("tenant_id","user_id","timestamp");--> statement-breakpoint
CREATE INDEX "phi_access_patient_idx" ON "phi_access_log" USING btree ("tenant_id","patient_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "pin_attempts_user_uniq" ON "pin_attempts" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_users_email_uniq" ON "platform_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "product_recalls_tenant_idx" ON "product_recalls" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_recalls_tenant_id_uniq" ON "product_recalls" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_id_uniq" ON "products" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_jti_idx" ON "refresh_tokens" USING btree ("user_id","jti");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "service_bundle_items_bundle_idx" ON "service_bundle_items" USING btree ("tenant_id","bundle_service_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "service_catalog_tenant_code_idx" ON "service_catalog" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "service_catalog_search_idx" ON "service_catalog" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "service_catalog_tenant_id_uniq" ON "service_catalog" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_categories_tenant_id_uniq" ON "service_categories" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "service_eligible_products_service_idx" ON "service_eligible_products" USING btree ("tenant_id","service_id","ranking");--> statement-breakpoint
CREATE INDEX "service_eligible_products_product_idx" ON "service_eligible_products" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "service_prices_lookup_idx" ON "service_prices" USING btree ("tenant_id","service_id","branch_id","payer_id","product_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "service_prices_tenant_id_uniq" ON "service_prices" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "staff_time_logs_user_idx" ON "staff_time_logs" USING btree ("tenant_id","user_id","clock_in_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_time_logs_tenant_id_uniq" ON "staff_time_logs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "soti_template_day_seq_idx" ON "standing_order_template_items" USING btree ("template_id","day_offset","sequence");--> statement-breakpoint
CREATE INDEX "soti_service_idx" ON "standing_order_template_items" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sot_tenant_code_idx" ON "standing_order_templates" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "sot_tenant_id_uniq" ON "standing_order_templates" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_definitions_tenant_tag_uniq" ON "tag_definitions" USING btree ("tenant_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_definitions_tenant_id_uniq" ON "tag_definitions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "tenant_counters_tenant_kind_idx" ON "tenant_counters" USING btree ("tenant_id","counter_kind");--> statement-breakpoint
CREATE INDEX "tenant_counters_tenant_branch_kind_idx" ON "tenant_counters" USING btree ("tenant_id","branch_id","counter_kind");--> statement-breakpoint
CREATE INDEX "tx_items_transaction_idx" ON "transaction_items" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "tx_items_clinical_order_idx" ON "transaction_items" USING btree ("clinical_order_id");--> statement-breakpoint
CREATE INDEX "tx_items_performed_by_idx" ON "transaction_items" USING btree ("performed_by_id");--> statement-breakpoint
CREATE INDEX "tx_items_patient_idx" ON "transaction_items" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_items_tenant_id_uniq" ON "transaction_items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "transaction_patients_transaction_idx" ON "transaction_patients" USING btree ("tenant_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_patients_txn_patient_uniq" ON "transaction_patients" USING btree ("transaction_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_patients_tenant_id_uniq" ON "transaction_patients" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_patient_idx" ON "transactions" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_branch_date_idx" ON "transactions" USING btree ("tenant_id","branch_id","transacted_at");--> statement-breakpoint
CREATE INDEX "transactions_tenant_status_idx" ON "transactions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_tenant_receipt_no_idx" ON "transactions" USING btree ("tenant_id","receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_tenant_id_uniq" ON "transactions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_status_active_idx" ON "transactions" USING btree ("tenant_id","status","transacted_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "txn_status_history_entity_idx" ON "transactions_status_history" USING btree ("tenant_id","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("tenant_id","user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "users_tenant_primary_branch_idx" ON "users" USING btree ("tenant_id","primary_branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_id_uniq" ON "users" USING btree ("tenant_id","id");
