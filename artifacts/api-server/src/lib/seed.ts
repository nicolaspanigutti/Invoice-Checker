import { db, usersTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { logger } from "./logger";

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);

  if (existing.length > 0) {
    logger.info("Database already seeded — skipping.");
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME ?? "Admin";

  if (!adminEmail || !adminPassword) {
    logger.warn(
      "ADMIN_EMAIL and ADMIN_PASSWORD environment variables are not set. " +
      "Skipping initial admin user creation. Set these variables and restart to create the first admin account.",
    );
    return;
  }

  logger.info(`Creating initial admin user: ${adminEmail}`);

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await db.insert(usersTable).values({
    email: adminEmail,
    passwordHash,
    displayName: adminName,
    role: "super_admin",
    isActive: true,
  });

  logger.info("Initial admin user created successfully.");
}
