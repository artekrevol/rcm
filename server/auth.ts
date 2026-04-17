import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import bcrypt from "bcryptjs";
import { type Express } from "express";
import { pool } from "./db";
import { Store } from "express-session";

class PgSessionStore extends Store {
  private pruneInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.pruneInterval = setInterval(() => this.pruneSessions(), 15 * 60 * 1000);
    if (this.pruneInterval.unref) this.pruneInterval.unref();
  }

  async get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void) {
    try {
      const result = await pool.query(
        'SELECT sess FROM "session" WHERE sid = $1 AND expire > NOW()',
        [sid]
      );
      callback(null, result.rows[0]?.sess || null);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    try {
      const maxAge = (sess.cookie?.maxAge) || 86400000;
      const expire = new Date(Date.now() + maxAge);
      await pool.query(
        `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = $2, expire = $3`,
        [sid, JSON.stringify(sess), expire]
      );
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void) {
    try {
      await pool.query('DELETE FROM "session" WHERE sid = $1', [sid]);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async touch(sid: string, sess: session.SessionData, callback?: (err?: any) => void) {
    try {
      const maxAge = (sess.cookie?.maxAge) || 86400000;
      const expire = new Date(Date.now() + maxAge);
      await pool.query(
        'UPDATE "session" SET expire = $1 WHERE sid = $2',
        [expire, sid]
      );
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  private async pruneSessions() {
    try {
      await pool.query('DELETE FROM "session" WHERE expire < NOW()');
    } catch (err) {
      console.error("Session prune error:", err);
    }
  }
}

export async function ensureSessionTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith("$2")) {
    return password === hash;
  }
  return bcrypt.compare(password, hash);
}

export function needsRehash(hash: string): boolean {
  return !hash.startsWith("$2");
}

export function setupAuth(app: Express) {
  const isProduction = process.env.NODE_ENV === "production";
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sessionSecret && isProduction) {
    throw new Error("SESSION_SECRET environment variable is required in production");
  }

  if (isProduction) {
    app.set("trust proxy", 1);
  }

  app.use(
    session({
      store: new PgSessionStore(),
      secret: sessionSecret || "claimshield-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const { getUserForAuth, rehashIfNeeded } = await import("./services/user-service");
          const user = await getUserForAuth(email);
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }
          const valid = await verifyPassword(password, user.password);
          if (!valid) {
            return done(null, false, { message: "Invalid email or password" });
          }
          rehashIfNeeded(user.id, password, user.password).catch(() => {});
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const { getUserById } = await import("./services/user-service");
      const user = await getUserById(id);
      done(null, user || null);
    } catch (err) {
      done(err);
    }
  });

  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  const LOGIN_LIMIT = 10;
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;

  app.post("/api/auth/login", (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (record && now < record.resetAt) {
      if (record.count >= LOGIN_LIMIT) {
        console.warn(`Login rate limit exceeded for IP: ${ip}`);
        return res.status(429).json({ error: "Too many login attempts. Please try again later." });
      }
    } else if (record && now >= record.resetAt) {
      loginAttempts.delete(ip);
    }

    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        const entry = loginAttempts.get(ip);
        if (entry && now < entry.resetAt) {
          entry.count++;
        } else {
          loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
        }
        return res.status(401).json({ error: info?.message || "Login failed" });
      }
      loginAttempts.delete(ip);
      req.logIn(user, (err) => {
        if (err) return next(err);
        pool.query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [user.id]).catch(() => {});
        const { password, ...safeUser } = user;
        return res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ success: true });
      });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const { password, ...safeUser } = req.user as any;
    const impersonatingOrgId = (req.session as any).impersonatingOrgId || null;
    const impersonatingOrgName = (req.session as any).impersonatingOrgName || null;
    res.json({ ...safeUser, impersonatingOrgId, impersonatingOrgName });
  });
}

export function requireAuth(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const userRole = (req.user as any).role;
    if (userRole === "super_admin") return next();
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

export function requireSuperAdmin(req: any, res: any, next: any) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if ((req.user as any).role !== "super_admin") {
    return res.status(403).json({ error: "Super admin access required" });
  }
  next();
}
