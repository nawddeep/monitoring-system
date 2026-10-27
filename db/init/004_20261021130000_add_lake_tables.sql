-- CreateEnum
CREATE TYPE "station_kind" AS ENUM ('PHYSICAL', 'SIMULATED');

-- CreateEnum
CREATE TYPE "reading_flag" AS ENUM ('OK', 'SUSPECT', 'BAD');

-- CreateEnum
CREATE TYPE "sample_source" AS ENUM ('LAB', 'FIELD_KIT');

-- CreateEnum
CREATE TYPE "result_qualifier" AS ENUM ('EQUAL', 'LESS_THAN', 'GREATER_THAN');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "site" (
    "id" UUID NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "station_kind" NOT NULL DEFAULT 'PHYSICAL',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "installed_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor" (
    "id" UUID NOT NULL,
    "serial_number" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "notes" TEXT,

    CONSTRAINT "sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_installation" (
    "id" UUID NOT NULL,
    "sensor_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "depth_m" DECIMAL(6,2),
    "installed_at" TIMESTAMPTZ(6) NOT NULL,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "sensor_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter_limit" (
    "id" SERIAL NOT NULL,
    "standard_id" INTEGER NOT NULL,
    "parameter_id" INTEGER NOT NULL,
    "min_value" DOUBLE PRECISION,
    "max_value" DOUBLE PRECISION,

    CONSTRAINT "parameter_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading" (
    "id" BIGSERIAL NOT NULL,
    "station_id" UUID NOT NULL,
    "sensor_id" UUID NOT NULL,
    "parameter_id" INTEGER NOT NULL,
    "measured_at" TIMESTAMPTZ(6) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "flag" "reading_flag" NOT NULL DEFAULT 'OK',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calibration" (
    "id" UUID NOT NULL,
    "sensor_id" UUID NOT NULL,
    "parameter_id" INTEGER NOT NULL,
    "performed_at" TIMESTAMPTZ(6) NOT NULL,
    "performed_by_id" TEXT,
    "reference_value" DOUBLE PRECISION,
    "sensor_before" DOUBLE PRECISION,
    "sensor_after" DOUBLE PRECISION,
    "offset" DOUBLE PRECISION,
    "slope" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "calibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "station_id" UUID,
    "source" "sample_source" NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL,
    "depth_m" DECIMAL(6,2),
    "lab_name" TEXT,
    "collected_by_id" TEXT,
    "notes" TEXT,

    CONSTRAINT "sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_result" (
    "id" UUID NOT NULL,
    "sample_id" UUID NOT NULL,
    "parameter_id" INTEGER NOT NULL,
    "value" DOUBLE PRECISION,
    "qualifier" "result_qualifier" NOT NULL DEFAULT 'EQUAL',
    "method" TEXT,

    CONSTRAINT "sample_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "parameter_id" INTEGER,
    "reading_id" BIGINT,
    "severity" "alert_severity" NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "acknowledged_by_id" TEXT,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_organization_id_name_key" ON "site"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "station_site_id_name_key" ON "station"("site_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sensor_serial_number_key" ON "sensor"("serial_number");

-- CreateIndex
CREATE INDEX "sensor_installation_station_id_installed_at_idx" ON "sensor_installation"("station_id", "installed_at");

-- CreateIndex
CREATE INDEX "sensor_installation_sensor_id_installed_at_idx" ON "sensor_installation"("sensor_id", "installed_at");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_code_key" ON "parameter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "standard_name_key" ON "standard"("name");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_limit_standard_id_parameter_id_key" ON "parameter_limit"("standard_id", "parameter_id");

-- CreateIndex
CREATE INDEX "reading_station_id_parameter_id_measured_at_idx" ON "reading"("station_id", "parameter_id", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "reading_sensor_id_parameter_id_measured_at_key" ON "reading"("sensor_id", "parameter_id", "measured_at");

-- CreateIndex
CREATE INDEX "calibration_sensor_id_parameter_id_performed_at_idx" ON "calibration"("sensor_id", "parameter_id", "performed_at");

-- CreateIndex
CREATE INDEX "sample_site_id_collected_at_idx" ON "sample"("site_id", "collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "sample_result_sample_id_parameter_id_key" ON "sample_result"("sample_id", "parameter_id");

-- CreateIndex
CREATE INDEX "alert_station_id_status_created_at_idx" ON "alert"("station_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station" ADD CONSTRAINT "station_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installation" ADD CONSTRAINT "sensor_installation_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installation" ADD CONSTRAINT "sensor_installation_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter_limit" ADD CONSTRAINT "parameter_limit_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "standard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parameter_limit" ADD CONSTRAINT "parameter_limit_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading" ADD CONSTRAINT "reading_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading" ADD CONSTRAINT "reading_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading" ADD CONSTRAINT "reading_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration" ADD CONSTRAINT "calibration_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration" ADD CONSTRAINT "calibration_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration" ADD CONSTRAINT "calibration_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample" ADD CONSTRAINT "sample_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample" ADD CONSTRAINT "sample_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample" ADD CONSTRAINT "sample_collected_by_id_fkey" FOREIGN KEY ("collected_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_result" ADD CONSTRAINT "sample_result_sample_id_fkey" FOREIGN KEY ("sample_id") REFERENCES "sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_result" ADD CONSTRAINT "sample_result_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "parameter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "reading"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security: block Supabase's public Data API roles (anon, authenticated).
-- No policies are defined, so those roles see nothing; the app connects as the table
-- owner and is unaffected. Harmless on plain PostgreSQL.
ALTER TABLE "site" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "station" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sensor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sensor_installation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parameter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "standard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parameter_limit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reading" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calibration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sample_result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert" ENABLE ROW LEVEL SECURITY;
