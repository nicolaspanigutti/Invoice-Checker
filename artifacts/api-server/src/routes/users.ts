import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middleware/auth";

const router: IRouter = Router();

function userToResponse(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
  };
}

router.get("/users", requireRole("super_admin"), async (req: Request, res: Response) => {
  const users = await db.select().from(usersTable).orderBy(usersTable.displayName);
  res.json(users.map(userToResponse));
});

router.post("/users", requireRole("super_admin"), async (req: Request, res: Response) => {
  const { displayName, email, password, role } = req.body;

  if (!displayName || !email || !password || !role) {
    res.status(400).json({ error: "displayName, email, password, and role are required" });
    return;
  }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(400).json({ error: "A user with that email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({
    displayName,
    email,
    passwordHash,
    role,
    isActive: true,
  }).returning();

  res.status(201).json(userToResponse(user));
});

router.put("/users/:id", requireRole("super_admin"), async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const { displayName, role, isActive, password } = req.body;

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (displayName !== undefined) updateData.displayName = displayName;
  if (role !== undefined) updateData.role = role;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

  const [updated] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(userToResponse(updated));
});

export default router;
