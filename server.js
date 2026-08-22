const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing.");
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error("ERROR: JWT_SECRET is missing.");
  process.exit(1);
}

/* =========================
   MIDDLEWARE
========================= */

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

/* =========================
   DATABASE
========================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================
   DATABASE INITIALIZATION
========================= */

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      premium BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      plan TEXT DEFAULT 'premium',
      provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      started_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      priority TEXT DEFAULT 'medium',
      completed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_date DATE NOT NULL,
      event_time TIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS goals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      target INTEGER NOT NULL,
      progress INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("Database initialized successfully.");
}

/* =========================
   JWT
========================= */

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email
    },
    JWT_SECRET,
    {
      expiresIn: "7d"
    }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Authentification requise."
    });
  }

  const token = header.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Session expirée ou token invalide."
    });
  }
}

/* =========================
   HEALTH
========================= */

app.get("/", async (req, res) => {
  res.json({
    app: "Lumio",
    backend: "online",
    version: "3.1.0"
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      app: "Lumio",
      backend: "online",
      database: "online",
      version: "3.1.0",
      features: [
        "authentication",
        "postgresql",
        "tasks",
        "planning",
        "notes",
        "budget",
        "goals",
        "focus",
        "premium",
        "subscription-status",
        "pwa-ready"
      ]
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(500).json({
      success: false,
      backend: "online",
      database: "offline"
    });
  }
});

/* =========================
   REGISTER
========================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email et mot de passe requis."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Le mot de passe doit contenir au moins 6 caractères."
      });
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Un compte existe déjà avec cet email."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users
      (email, password_hash, premium)
      VALUES ($1, $2, FALSE)
      RETURNING id, email, premium, created_at
      `,
      [email, passwordHash]
    );

    const user = result.rows[0];

    const token = createToken(user);

    res.status(201).json({
      success: true,
      message: "Compte créé avec succès.",
      token,
      user
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      success: false,
      error: "Erreur lors de la création du compte."
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email et mot de passe requis."
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        email,
        password_hash,
        premium,
        created_at
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Email ou mot de passe incorrect."
      });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: "Email ou mot de passe incorrect."
      });
    }

    const token = createToken(user);

    delete user.password_hash;

    res.json({
      success: true,
      message: "Connexion réussie.",
      token,
      user
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      error: "Erreur lors de la connexion."
    });
  }
});

/* =========================
   CURRENT USER
========================= */

app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, email, premium, created_at
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable."
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Me error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de récupérer le compte."
    });
  }
});

/* =========================
   TASKS
========================= */

app.get("/api/tasks", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, title, priority, completed, created_at
      FROM tasks
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      success: true,
      tasks: result.rows
    });
  } catch (error) {
    console.error("Get tasks error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de récupérer les tâches."
    });
  }
});

app.post("/api/tasks", authenticate, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();

    const priority =
      ["low", "medium", "high"].includes(req.body.priority)
        ? req.body.priority
        : "medium";

    if (!title) {
      return res.status(400).json({
        success: false,
        error: "Le titre de la tâche est requis."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO tasks
      (user_id, title, priority)
      VALUES ($1, $2, $3)
      RETURNING id, title, priority, completed, created_at
      `,
      [req.user.id, title, priority]
    );

    res.status(201).json({
      success: true,
      task: result.rows[0]
    });
  } catch (error) {
    console.error("Create task error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de créer la tâche."
    });
  }
});

app.patch("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const completed =
      Boolean(req.body.completed);

    const result = await pool.query(
      `
      UPDATE tasks
      SET completed = $1
      WHERE id = $2
      AND user_id = $3
      RETURNING id, title, priority, completed, created_at
      `,
      [completed, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Tâche introuvable."
      });
    }

    res.json({
      success: true,
      task: result.rows[0]
    });
  } catch (error) {
    console.error("Update task error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de modifier la tâche."
    });
  }
});

app.delete("/api/tasks/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM tasks
      WHERE id = $1
      AND user_id = $2
      RETURNING id
      `,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Tâche introuvable."
      });
    }

    res.json({
      success: true,
      message: "Tâche supprimée."
    });
  } catch (error) {
    console.error("Delete task error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer la tâche."
    });
  }
});

/* =========================
   PLANNING / EVENTS
========================= */

app.get("/api/events", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, title, event_date, event_time, created_at
      FROM events
      WHERE user_id = $1
      ORDER BY event_date ASC, event_time ASC
      `,
      [req.user.id]
    );

    res.json({
      success: true,
      events: result.rows
    });
  } catch (error) {
    console.error("Get events error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de récupérer le planning."
    });
  }
});

app.post("/api/events", authenticate, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const eventDate = String(req.body.date || "").trim();
    const eventTime = req.body.time
      ? String(req.body.time)
      : null;

    if (!title || !eventDate) {
      return res.status(400).json({
        success: false,
        error: "Titre et date requis."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO events
      (user_id, title, event_date, event_time)
      VALUES ($1, $2, $3, $4)
      RETURNING id, title, event_date, event_time, created_at
      `,
      [
        req.user.id,
        title,
        eventDate,
        eventTime
      ]
    );

    res.status(201).json({
      success: true,
      event: result.rows[0]
    });
  } catch (error) {
    console.error("Create event error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de créer l'événement."
    });
  }
});

app.delete("/api/events/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM events
      WHERE id = $1
      AND user_id = $2
      RETURNING id
      `,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Événement introuvable."
      });
    }

    res.json({
      success: true,
      message: "Événement supprimé."
    });
  } catch (error) {
    console.error("Delete event error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer l'événement."
    });
  }
});

/* =========================
   NOTES
========================= */

app.get("/api/notes", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, title, content, created_at
      FROM notes
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      success: true,
      notes: result.rows
    });
  } catch (error) {
    console.error("Get notes error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de récupérer les notes."
    });
  }
});

app.post("/api/notes", authenticate, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: "Titre et contenu requis."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO notes
      (user_id, title, content)
      VALUES ($1, $2, $3)
      RETURNING id, title, content, created_at
      `,
      [
        req.user.id,
        title,
        content
      ]
    );

    res.status(201).json({
      success: true,
      note: result.rows[0]
    });
  } catch (error) {
    console.error("Create note error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de créer la note."
    });
  }
});

app.delete("/api/notes/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM notes
      WHERE id = $1
      AND user_id = $2
      RETURNING id
      `,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Note introuvable."
      });
    }

    res.json({
      success: true,
      message: "Note supprimée."
    });
  } catch (error) {
    console.error("Delete note error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer la note."
    });
  }
});

/* =========================
   BUDGET
========================= */

app.get("/api/budget", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, description, amount, type, created_at
      FROM budgets
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      success: true,
      budget: result.rows
    });
  } catch (error) {
    console.error("Get budget error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de récupérer le budget."
    });
  }
});

app.post("/api/budget", authenticate, async (req, res) => {
  try {
    const description =
      String(req.body.description || "").trim();

    const amount =
      Number(req.body.amount);

    const type =
      req.body.type === "income"
        ? "income"
        : "expense";

    if (!description) {
      return res.status(400).json({
        success: false,
        error: "Description requise."
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Montant invalide."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO budgets
      (user_id, description, amount, type)
      VALUES ($1, $2, $3, $4)
      RETURNING id, description, amount, type, created_at
      `,
      [
        req.user.id,
        description,
        amount,
        type
      ]
    );

    res.status(201).json({
      success: true,
      budget: result.rows[0]
    });
  } catch (error) {
    console.error("Create budget error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible d'ajouter l'opération."
    });
  }
});

app.delete("/api/budget/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM budgets
      WHERE id = $1
      AND user_id = $2
      RETURNING id
      `,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Opération introuvable."
      });
    }

    res.json({
      success: true,
      message: "Opération supprimée."
    });
  } catch (error) {
    console.error("Delete budget error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer l'opération."
    });
  }
});

/* =========================
   GOALS
========================= */

app.get("/api/goals", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, title, target, progress, created_at
      FROM goals
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      success: true,
      goals: result.rows
    });
  } catch (error) {
    console.error("Get goals error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de récupérer les objectifs."
    });
  }
});

app.post("/api/goals", authenticate, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();

    const target = Number(req.body.target);

    if (!title) {
      return res.status(400).json({
        success: false,
        error: "Titre de l'objectif requis."
      });
    }

    if (!Number.isInteger(target) || target <= 0) {
      return res.status(400).json({
        success: false,
        error: "La cible doit être un entier positif."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO goals
      (user_id, title, target, progress)
      VALUES ($1, $2, $3, 0)
      RETURNING id, title, target, progress, created_at
      `,
      [
        req.user.id,
        title,
        target
      ]
    );

    res.status(201).json({
      success: true,
      goal: result.rows[0]
    });/* =========================
   UPDATE GOAL
========================= */

app.patch("/api/goals/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Identifiant d'objectif invalide."
      });
    }

    const progress = Number(req.body.progress);

    if (!Number.isInteger(progress) || progress < 0) {
      return res.status(400).json({
        success: false,
        error: "Progression invalide."
      });
    }

    const result = await pool.query(
      `
      UPDATE goals
      SET progress = LEAST(progress, target)
      WHERE id = $1
      AND user_id = $2
      RETURNING id, title, target, progress, created_at
      `,
      [
        id,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Objectif introuvable."
      });
    }

    res.json({
      success: true,
      goal: result.rows[0]
    });

  } catch (error) {

    console.error("Update goal error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de modifier l'objectif."
    });

  }
});


/* =========================
   DELETE GOAL
========================= */

app.delete("/api/goals/:id", authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Identifiant d'objectif invalide."
      });
    }

    const result = await pool.query(
      `
      DELETE FROM goals
      WHERE id = $1
      AND user_id = $2
      RETURNING id
      `,
      [
        id,
        req.user.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Objectif introuvable."
      });
    }

    res.json({
      success: true,
      message: "Objectif supprimé."
    });

  } catch (error) {

    console.error("Delete goal error:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer l'objectif."
    });

  }
});


/* =========================
   PREMIUM STATUS
========================= */

app.get(
  "/api/subscription/status",
  authenticate,
  async (req, res) => {

    try {

      const userResult = await pool.query(
        `
        SELECT
          id,
          email,
          premium
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Utilisateur introuvable."
        });
      }

      const user = userResult.rows[0];

      const subscriptionResult = await pool.query(
        `
        SELECT
          id,
          status,
          plan,
          provider,
          started_at,
          expires_at,
          created_at
        FROM subscriptions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [req.user.id]
      );

      const subscription =
        subscriptionResult.rows.length > 0
          ? subscriptionResult.rows[0]
          : null;

      res.json({
        success: true,

        premium: Boolean(user.premium),

        user: {
          id: user.id,
          email: user.email
        },

        subscription

      });

    } catch (error) {

      console.error(
        "Subscription status error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de récupérer le statut Premium."
      });

    }

  }
);


/* =========================
   ACTIVATE PREMIUM
   =========================
   
   Cette route sert actuellement
   de test pour activer Premium.
   
   Plus tard, elle sera remplacée
   par la confirmation réelle du paiement.
========================= */

app.post(
  "/api/subscription/activate",
  authenticate,
  async (req, res) => {

    try {

      const plan =
        String(req.body.plan || "premium");

      const provider =
        String(req.body.provider || "manual");

      const existing =
        await pool.query(
          `
          SELECT id
          FROM subscriptions
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [req.user.id]
        );

      let subscription;

      if (existing.rows.length > 0) {

        const result =
          await pool.query(
            `
            UPDATE subscriptions
            SET
              status = 'active',
              plan = $1,
              provider = $2,
              started_at = COALESCE(
                started_at,
                CURRENT_TIMESTAMP
              ),
              expires_at = NULL
            WHERE id = $3
            RETURNING
              id,
              status,
              plan,
              provider,
              started_at,
              expires_at,
              created_at
            `,
            [
              plan,
              provider,
              existing.rows[0].id
            ]
          );

        subscription =
          result.rows[0];

      } else {

        const result =
          await pool.query(
            `
            INSERT INTO subscriptions
            (
              user_id,
              status,
              plan,
              provider,
              started_at
            )
            VALUES
            (
              $1,
              'active',
              $2,
              $3,
              CURRENT_TIMESTAMP
            )
            RETURNING
              id,
              status,
              plan,
              provider,
              started_at,
              expires_at,
              created_at
            `,
            [
              req.user.id,
              plan,
              provider
            ]
          );

        subscription =
          result.rows[0];

      }

      await pool.query(
        `
        UPDATE users
        SET premium = TRUE
        WHERE id = $1
        `,
        [req.user.id]
      );

      res.json({

        success: true,

        message:
          "Premium activé avec succès.",

        premium: true,

        subscription

      });

    } catch (error) {

      console.error(
        "Activate premium error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible d'activer Premium."
      });

    }

  }
);


/* =========================
   DISABLE PREMIUM
   =========================
   
   Route utile pour les tests.
========================= */

app.post(
  "/api/subscription/cancel",
  authenticate,
  async (req, res) => {

    try {

      await pool.query(
        `
        UPDATE users
        SET premium = FALSE
        WHERE id = $1
        `,
        [req.user.id]
      );

      await pool.query(
        `
        UPDATE subscriptions
        SET status = 'cancelled'
        WHERE user_id = $1
        AND status = 'active'
        `,
        [req.user.id]
      );

      res.json({
        success: true,
        premium: false,
        message: "Premium désactivé."
      });

    } catch (error) {

      console.error(
        "Cancel premium error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de désactiver Premium."
      });

    }

  }
);


/* =========================
   404
========================= */

app.use((req, res) => {

  res.status(404).json({
    success: false,
    error: "Route introuvable."
  });

});


/* =========================
   GLOBAL ERROR HANDLER
========================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "Unhandled server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      success: false,
      error:
        "Erreur interne du serveur."
    });

  }
);


/* =========================
   START SERVER
========================= */

async function startServer() {

  try {

    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `Lumio Backend 3.1.0 running on port ${PORT}`
        );

        console.log(
          `Environment: ${
            process.env.NODE_ENV || "development"
          }`
        );

      }
    );

  } catch (error) {

    console.error(
      "Failed to start Lumio Backend:",
      error
    );

    process.exit(1);

  }

}


/* =========================
   START
========================= */

startServer();
