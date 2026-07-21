-- Transport Management v1, Phase A (additive only; forward-only; no
-- destructive change; does not edit any prior migration file).
--
-- Full model set (Route, Stop, Vehicle, Driver, StudentRouteAssignment, Trip)
-- lands in this one migration even though Phase A (admin CRUD) only uses
-- Route/Stop/Vehicle/Driver/StudentRouteAssignment — Trip exists for Phases
-- B/C (driver auth + trip lifecycle, location ingest) so those phases don't
-- each need their own migration. Live position is intentionally NOT modeled
-- here; Phase B stores it in Redis as a latest-position-only key.
--
-- ALTER TYPE ... ADD VALUE for FeatureFlagKey follows the exact pattern of
-- 20260717000000_library_management_v1: the new enum literal is NOT
-- referenced anywhere in this same migration, so PostgreSQL's "new enum
-- value unusable in the transaction that added it" rule is respected.

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FeatureFlagKey" ADD VALUE 'TRANSPORT';

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "vehicleId" TEXT,
    "driverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stop" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "capacity" INTEGER,
    "model" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "licenseNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRouteAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentRouteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Route_schoolId_idx" ON "Route"("schoolId");

-- CreateIndex
CREATE INDEX "Route_schoolId_vehicleId_idx" ON "Route"("schoolId", "vehicleId");

-- CreateIndex
CREATE INDEX "Route_schoolId_driverId_idx" ON "Route"("schoolId", "driverId");

-- CreateIndex
CREATE INDEX "Stop_schoolId_idx" ON "Stop"("schoolId");

-- CreateIndex
CREATE INDEX "Stop_routeId_idx" ON "Stop"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Stop_routeId_sequence_key" ON "Stop"("routeId", "sequence");

-- CreateIndex
CREATE INDEX "Vehicle_schoolId_idx" ON "Vehicle"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_schoolId_registrationNumber_key" ON "Vehicle"("schoolId", "registrationNumber");

-- CreateIndex
CREATE INDEX "Driver_schoolId_idx" ON "Driver"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_schoolId_phone_key" ON "Driver"("schoolId", "phone");

-- CreateIndex
CREATE INDEX "StudentRouteAssignment_schoolId_idx" ON "StudentRouteAssignment"("schoolId");

-- CreateIndex
CREATE INDEX "StudentRouteAssignment_routeId_idx" ON "StudentRouteAssignment"("routeId");

-- CreateIndex
CREATE INDEX "StudentRouteAssignment_stopId_idx" ON "StudentRouteAssignment"("stopId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRouteAssignment_studentId_routeId_key" ON "StudentRouteAssignment"("studentId", "routeId");

-- CreateIndex
CREATE INDEX "Trip_schoolId_idx" ON "Trip"("schoolId");

-- CreateIndex
CREATE INDEX "Trip_routeId_idx" ON "Trip"("routeId");

-- CreateIndex
CREATE INDEX "Trip_driverId_idx" ON "Trip"("driverId");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stop" ADD CONSTRAINT "Stop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRouteAssignment" ADD CONSTRAINT "StudentRouteAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRouteAssignment" ADD CONSTRAINT "StudentRouteAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRouteAssignment" ADD CONSTRAINT "StudentRouteAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRouteAssignment" ADD CONSTRAINT "StudentRouteAssignment_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
