import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (roles.length > 0 && !roles.includes(req.session.userRole || "")) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
