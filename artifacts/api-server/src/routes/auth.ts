import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "../lib/crypto";
import { createAIClient, type AIProvider, type AICompletionClient } from "../lib/aiClient";

const router: IRouter = Router();

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: string;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUserResponse(user: {
  id: number;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  encryptedOpenaiKey: string | null;
  encryptedAnthropicKey: string | null;
  encryptedGeminiKey: string | null;
  aiProvider: string;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    hasOpenaiKey: !!user.encryptedOpenaiKey,
    hasAnthropicKey: !!user.encryptedAnthropicKey,
    hasGeminiKey: !!user.encryptedGeminiKey,
    aiProvider: user.aiProvider,
  };
}

const KEY_COLUMN_MAP = {
  openai: "encryptedOpenaiKey",
  anthropic: "encryptedAnthropicKey",
  gemini: "encryptedGeminiKey",
} as const satisfies Record<AIProvider, keyof typeof usersTable.$inferSelect>;

const KEY_FORMAT_HINTS: Record<AIProvider, string> = {
  openai: "OpenAI keys start with sk-",
  anthropic: "Anthropic keys start with sk-ant-",
  gemini: "Gemini keys start with AI",
};

function validateKeyFormat(provider: AIProvider, key: string): string | null {
  if (provider === "openai" && !key.startsWith("sk-")) {
    return KEY_FORMAT_HINTS.openai;
  }
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    return KEY_FORMAT_HINTS.anthropic;
  }
  if (provider === "gemini" && !key.startsWith("AI")) {
    return KEY_FORMAT_HINTS.gemini;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

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

  res.json(formatUserResponse(user));
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

  res.json(formatUserResponse(user));
});

// ---------------------------------------------------------------------------
// AI key management — generic endpoints for all providers
// ---------------------------------------------------------------------------

router.put("/auth/me/ai-key/:provider", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const provider = req.params.provider as AIProvider;
  if (!["openai", "anthropic", "gemini"].includes(provider)) {
    res.status(400).json({ error: "Invalid provider. Must be openai, anthropic, or gemini." });
    return;
  }

  const { key } = req.body as { key?: string };
  if (!key || typeof key !== "string" || !key.trim()) {
    res.status(400).json({ error: "key is required" });
    return;
  }

  const trimmed = key.trim();
  const formatError = validateKeyFormat(provider, trimmed);
  if (formatError) {
    res.status(400).json({ error: `Invalid API key format — ${formatError}` });
    return;
  }

  let encrypted: string;
  try {
    encrypted = encryptApiKey(trimmed);
  } catch (err) {
    req.log.error({ err }, "Failed to encrypt API key");
    res.status(500).json({ error: "Encryption service unavailable" });
    return;
  }

  const column = KEY_COLUMN_MAP[provider];
  await db.update(usersTable)
    .set({ [column]: encrypted })
    .where(eq(usersTable.id, req.session.userId));

  res.json({ provider, saved: true });
});

router.delete("/auth/me/ai-key/:provider", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const provider = req.params.provider as AIProvider;
  if (!["openai", "anthropic", "gemini"].includes(provider)) {
    res.status(400).json({ error: "Invalid provider. Must be openai, anthropic, or gemini." });
    return;
  }

  const column = KEY_COLUMN_MAP[provider];
  await db.update(usersTable)
    .set({ [column]: null })
    .where(eq(usersTable.id, req.session.userId));

  res.json({ provider, removed: true });
});

router.put("/auth/me/ai-provider", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { provider } = req.body as { provider?: AIProvider };
  if (!provider || !["openai", "anthropic", "gemini"].includes(provider)) {
    res.status(400).json({ error: "provider must be openai, anthropic, or gemini" });
    return;
  }

  await db.update(usersTable)
    .set({ aiProvider: provider })
    .where(eq(usersTable.id, req.session.userId));

  res.json({ aiProvider: provider });
});

// ---------------------------------------------------------------------------
// Exported helpers for use in other routes
// ---------------------------------------------------------------------------

export async function getUserAIClient(userId: number): Promise<AICompletionClient | null> {
  const [user] = await db
    .select({
      aiProvider: usersTable.aiProvider,
      encryptedOpenaiKey: usersTable.encryptedOpenaiKey,
      encryptedAnthropicKey: usersTable.encryptedAnthropicKey,
      encryptedGeminiKey: usersTable.encryptedGeminiKey,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return null;

  const provider = user.aiProvider as AIProvider;

  const encryptedKey =
    provider === "openai" ? user.encryptedOpenaiKey :
    provider === "anthropic" ? user.encryptedAnthropicKey :
    provider === "gemini" ? user.encryptedGeminiKey :
    null;

  if (!encryptedKey) return null;

  try {
    const apiKey = decryptApiKey(encryptedKey);
    return createAIClient(provider, apiKey);
  } catch {
    return null;
  }
}

export default router;
