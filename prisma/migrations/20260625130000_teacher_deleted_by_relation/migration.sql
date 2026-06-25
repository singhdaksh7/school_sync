-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
