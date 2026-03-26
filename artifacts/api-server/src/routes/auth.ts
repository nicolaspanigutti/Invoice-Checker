import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "../lib/crypto";

const router: IRouter = Router();

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: string;
  }
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  req.session.userId = user.id;
  req.session.userRole = user.role;

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    hasOpenaiKey: !!user.encryptedOpenaiKey,
  });
});

router.post("/auth/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Error destroying session");
      res.status(500).json({ error: "Failed to logout" });
      return;
    }
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out successfully" });
  });
});

router.get("/auth/me", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);

  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (user.role !== req.session.userRole) {
    req.session.userRole = user.role;
  }

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    hasOpenaiKey: !!user.encryptedOpenaiKey,
  });
});

router.put("/auth/me/openai-key", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { key } = req.body as { key?: string };

  if (!key || typeof key !== "string" || !key.trim()) {
    res.status(400).json({ error: "key is required" });
    return;
  }

  if (!key.startsWith("sk-")) {
    res.status(400).json({ error: "Invalid OpenAI API key format — must start with sk-" });
    return;
  }

  let encrypted: string;
  try {
    encrypted = encryptApiKey(key.trim());
  } catch (err) {
    req.log.error({ err }, "Failed to encrypt API key");
    res.status(500).json({ error: "Encryption service unavailable" });
    return;
  }

  await db.update(usersTable)
    .set({ encryptedOpenaiKey: encrypted })
    .where(eq(usersTable.id, req.session.userId));

  res.json({ hasOpenaiKey: true });
});

router.delete("/auth/me/openai-key", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  await db.update(usersTable)
    .set({ encryptedOpenaiKey: null })
    .where(eq(usersTable.id, req.session.userId));

  res.json({ hasOpenaiKey: false });
});

export function getUserOpenaiKey(userId: number): Promise<string | null> {
  return db.select({ encryptedOpenaiKey: usersTable.encryptedOpenaiKey })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1)
    .then(([user]) => {
      if (!user?.encryptedOpenaiKey) return null;
      try {
        return decryptApiKey(user.encryptedOpenaiKey);
      } catch {
        return null;
      }
    });
}

export default router;
