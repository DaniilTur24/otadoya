-- CreateTable
CREATE TABLE "pharmacies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT NOT NULL DEFAULT '',
    "coefficient" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "terminalRent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "procedureRent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_aliases" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL DEFAULT 'keyword',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "base_salary" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_revenue_entries" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "cash_revenue" DECIMAL(65,30) NOT NULL,
    "terminal_revenue" DECIMAL(65,30) NOT NULL,
    "kaspi_revenue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bonus_revenue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "additional_expenses" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "expense_comment" TEXT,
    "general_comment" TEXT,
    "employee_name" TEXT NOT NULL,
    "employee_id" INTEGER,
    "shift_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "excluded_from_report" BOOLEAN NOT NULL DEFAULT false,
    "bookkeeper_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_revenue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_expense_items" (
    "id" SERIAL NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "category" TEXT,
    "comment" TEXT,

    CONSTRAINT "daily_expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_files" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL DEFAULT 'other',
    "month" INTEGER,
    "year" INTEGER,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pharmacy_id" INTEGER,
    "file_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_expense_entries" (
    "id" SERIAL NOT NULL,
    "file_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER,
    "operation_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "counterparty" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewer_comment" TEXT,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "row_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extracted_expense_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_report_overrides" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "field_key" TEXT NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_report_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_pdf_reports" (
    "id" SERIAL NOT NULL,
    "pharmacy_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "markup_percent" DECIMAL(65,30),
    "stock_retail" DECIMAL(65,30),
    "stock_wholesale" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source_file" TEXT,
    "confident" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_pdf_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_import_rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "source_field" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'contains',
    "target_field_key" TEXT,
    "distribution_type" TEXT NOT NULL,
    "pharmacy_id" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_import_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_transactions" (
    "id" SERIAL NOT NULL,
    "upload_id" INTEGER NOT NULL,
    "transaction_date" TIMESTAMP(3),
    "amount" DECIMAL(65,30) NOT NULL,
    "counterparty" TEXT,
    "bin_iin" TEXT,
    "payment_purpose" TEXT,
    "raw_row_json" TEXT NOT NULL,
    "searchable_text" TEXT NOT NULL,
    "matched_rule_id" INTEGER,
    "detected_pharmacy_id" INTEGER,
    "target_field_key" TEXT,
    "distribution_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "accountant_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imported_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_report_values" (
    "id" SERIAL NOT NULL,
    "imported_transaction_id" INTEGER NOT NULL,
    "upload_id" INTEGER NOT NULL,
    "pharmacy_id" INTEGER,
    "field_key" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "distribution_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imported_report_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_field_configs" (
    "field_key" TEXT NOT NULL,
    "row_type" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_field_configs_pkey" PRIMARY KEY ("field_key")
);

-- CreateTable
CREATE TABLE "closed_months" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_json" TEXT NOT NULL,

    CONSTRAINT "closed_months_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pharmacies_name_key" ON "pharmacies"("name");

-- CreateIndex
CREATE INDEX "pharmacy_aliases_pharmacy_id_idx" ON "pharmacy_aliases"("pharmacy_id");

-- CreateIndex
CREATE INDEX "daily_revenue_entries_employee_id_idx" ON "daily_revenue_entries"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_report_overrides_year_month_pharmacy_id_field_key_key" ON "monthly_report_overrides"("year", "month", "pharmacy_id", "field_key");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_pdf_reports_pharmacy_id_year_month_key" ON "pharmacy_pdf_reports"("pharmacy_id", "year", "month");

-- CreateIndex
CREATE INDEX "transaction_import_rules_is_active_priority_idx" ON "transaction_import_rules"("is_active", "priority");

-- CreateIndex
CREATE INDEX "imported_transactions_upload_id_idx" ON "imported_transactions"("upload_id");

-- CreateIndex
CREATE INDEX "imported_transactions_status_idx" ON "imported_transactions"("status");

-- CreateIndex
CREATE INDEX "imported_report_values_upload_id_idx" ON "imported_report_values"("upload_id");

-- CreateIndex
CREATE INDEX "imported_report_values_pharmacy_id_idx" ON "imported_report_values"("pharmacy_id");

-- CreateIndex
CREATE INDEX "imported_report_values_field_key_idx" ON "imported_report_values"("field_key");

-- CreateIndex
CREATE INDEX "imported_report_values_status_idx" ON "imported_report_values"("status");

-- CreateIndex
CREATE UNIQUE INDEX "closed_months_year_month_key" ON "closed_months"("year", "month");

-- AddForeignKey
ALTER TABLE "pharmacy_aliases" ADD CONSTRAINT "pharmacy_aliases_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_revenue_entries" ADD CONSTRAINT "daily_revenue_entries_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_revenue_entries" ADD CONSTRAINT "daily_revenue_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_expense_items" ADD CONSTRAINT "daily_expense_items_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "daily_revenue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_expense_entries" ADD CONSTRAINT "extracted_expense_entries_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_expense_entries" ADD CONSTRAINT "extracted_expense_entries_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_report_overrides" ADD CONSTRAINT "monthly_report_overrides_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_pdf_reports" ADD CONSTRAINT "pharmacy_pdf_reports_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_import_rules" ADD CONSTRAINT "transaction_import_rules_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploaded_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_matched_rule_id_fkey" FOREIGN KEY ("matched_rule_id") REFERENCES "transaction_import_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_detected_pharmacy_id_fkey" FOREIGN KEY ("detected_pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_report_values" ADD CONSTRAINT "imported_report_values_imported_transaction_id_fkey" FOREIGN KEY ("imported_transaction_id") REFERENCES "imported_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_report_values" ADD CONSTRAINT "imported_report_values_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploaded_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_report_values" ADD CONSTRAINT "imported_report_values_pharmacy_id_fkey" FOREIGN KEY ("pharmacy_id") REFERENCES "pharmacies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
