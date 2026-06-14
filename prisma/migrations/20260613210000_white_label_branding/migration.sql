ALTER TABLE "School"
  ADD COLUMN "customDomain" TEXT,
  ADD COLUMN "primaryColor" TEXT,
  ADD COLUMN "secondaryColor" TEXT,
  ADD COLUMN "appName" TEXT,
  ADD COLUMN "poweredBySchoolSync" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "School_customDomain_key" ON "School"("customDomain");
