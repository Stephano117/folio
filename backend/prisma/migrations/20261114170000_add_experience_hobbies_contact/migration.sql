ALTER TABLE "Profile"
ADD COLUMN "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN "contactMessage" TEXT NOT NULL DEFAULT '',
ADD COLUMN "footerEyebrow" TEXT NOT NULL DEFAULT 'UN PROJET EN TÊTE ?',
ADD COLUMN "footerTitle" TEXT NOT NULL DEFAULT 'Parlons-en',
ADD COLUMN "footerText" TEXT NOT NULL DEFAULT '',
ADD COLUMN "footerNote" TEXT NOT NULL DEFAULT 'Conçu avec intention.';

ALTER TABLE "Skill"
ADD COLUMN "imageUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN "imagePublicId" TEXT NOT NULL DEFAULT '';

CREATE TABLE "Experience" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "imagePublicId" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Hobby" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "imagePublicId" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Hobby_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Experience_position_idx" ON "Experience"("position");
CREATE INDEX "Hobby_position_idx" ON "Hobby"("position");
