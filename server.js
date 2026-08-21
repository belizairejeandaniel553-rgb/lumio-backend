       require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

app.disable("x-powered-by");

// =====================================================
// CONFIGURATION
// =====================================================

const PORT = Number(process.env.PORT) || 10000;

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("ERREUR : JWT_SECRET manque dans Render.");
  process.exit(1);
}

// =====================================================
// TCHOTCHOM
// =====================================================

const TCHOTCHOM_API_KEY =
  process.env.TCHOTCHOM_API_KEY;

const TCHOTCHOM_SECRET_KEY =
  process.env.TCHOTCHOM_SECRET_KEY;

const TCHOTCHOM_PAYEE_EMAIL =
  process.env.TCHOTCHOM_PAYEE_EMAIL;

const TCHOTCHOM_BASE_URL =
  "https://www.sbfastgroup.com/api/v1";

if (!TCHOTCHOM_API_KEY) {
  console.warn(
    "ATTENTION : TCHOTCHOM_API_KEY manque."
  );
}

if (!TCHOTCHOM_SECRET_KEY) {
  console.warn(
    "ATTENTION : TCHOTCHOM_SECRET_KEY manque."
  );
}

if (!TCHOTCHOM_PAYEE_EMAIL) {
  console.warn(
    "ATTENTION : TCHOTCHOM_PAYEE_EMAIL manque."
  );
}

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

// =====================================================
// POSTGRESQL
// =====================================================

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString:
      process.env.DATABASE_URL,

    ssl:
      process.env.NODE_ENV === "production"
        ? {
            rejectUnauthorized: false
          }
        : false
  });

  pool.on("error", (error) => {
    console.error(
      "PostgreSQL error:",
      error
    );
  });
} else {
  console.error(
    "DATABASE_URL manque."
  );
}

// =====================================================
// AUTH
// =====================================================

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

function authenticate(
  req,
  res,
  next
) {
  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error:
        "Authentification requise."
    });
  }

  const token =
    header.substring(7);

  try {
    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    req.user = decoded;

    next();

  } catch {
    return res.status(401).json({
      success: false,
      error:
        "Session invalide ou expirée."
    });
  }
}

// =====================================================
// TCHOTCHOM AUTH
// =====================================================

function getTchotchomHeaders() {

  if (
    !TCHOTCHOM_API_KEY ||
    !TCHOTCHOM_SECRET_KEY
  ) {
    throw new Error(
      "Les identifiants Tchotchom ne sont pas configurés."
    );
  }

  const credentials =
    Buffer.from(
      `${TCHOTCHOM_API_KEY}:${TCHOTCHOM_SECRET_KEY}`
    ).toString("base64");

  return {
    Authorization:
      `Basic ${credentials}`,

    "Content-Type":
      "application/json",

    Accept:
      "application/json"
  };
}

// =====================================================
// DATABASE INITIALIZATION
// =====================================================

async function initializeDatabase() {

  if (!pool) {
    throw new Error(
      "DATABASE_URL non configurée."
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      premium BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id)
        ON DELETE CASCADE,

      status VARCHAR(30)
        NOT NULL DEFAULT 'inactive',

      plan VARCHAR(100)
        DEFAULT 'premium_monthly',

      provider VARCHAR(50),

      provider_customer_id TEXT,

      provider_subscription_id TEXT,

      started_at TIMESTAMP,

      expires_at TIMESTAMP,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id)
        ON DELETE CASCADE,

      provider VARCHAR(50)
        NOT NULL,

      provider_payment_id TEXT,

      reference TEXT,

      amount NUMERIC(12,2)
        NOT NULL,

      currency VARCHAR(10)
        NOT NULL,

      payment_method VARCHAR(50),

      status VARCHAR(50)
        DEFAULT 'pending',

      raw_response JSONB,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id)
        ON DELETE CASCADE,

      title TEXT NOT NULL,

      priority VARCHAR(20)
        DEFAULT 'medium',

      completed BOOLEAN
        DEFAULT FALSE,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id)
        ON DELETE CASCADE,

      title TEXT NOT NULL,

      event_date DATE,

      event_time TIME,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id)
        ON DELETE CASCADE,

      title TEXT NOT NULL,

      content TEXT DEFAULT '',

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id)
        ON DELETE CASCADE,

      description TEXT NOT NULL,

      amount NUMERIC(12,2)
        NOT NULL,

      type VARCHAR(20)
        NOT NULL,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS goals (
      id SERIAL PRIMARY KEY,

      user_id INTEGER REFERENCES users(id)
        ON DELETE CASCADE,

      title TEXT NOT NULL,

      target INTEGER NOT NULL,

      progress INTEGER
        DEFAULT 0,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log(
    "Lumio database ready."
  );
}

// =====================================================
// HOME
// =====================================================

app.get(
  "/",
  async (req, res) => {

    let database =
      "offline";

    if (pool) {

      try {

        await pool.query(
          "SELECT 1"
        );

        database =
          "online";

      } catch {

        database =
          "offline";
      }
    }

    res.json({
      app: "Lumio",
      backend: "online",
      database,
      version: "4.0.0",

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
        "subscriptions",
        "payments",
        "tchotchom",
        "moncash",
        "pwa-ready"
      ]
    });
  }
);

// =====================================================
// HEALTH
// =====================================================

app.get(
  "/api/health",
  async (req, res) => {

    let database =
      "not_configured";

    if (pool) {

      try {

        await pool.query(
          "SELECT 1"
        );

        database =
          "online";

      } catch {

        database =
          "offline";
      }
    }

    res.json({
      success: true,

      backend:
        "online",

      database,

      version:
        "4.0.0",

      tchotchomConfigured:
        Boolean(
          TCHOTCHOM_API_KEY &&
          TCHOTCHOM_SECRET_KEY &&
          TCHOTCHOM_PAYEE_EMAIL
        )
    });
  }
);

// =====================================================
// REGISTER
// =====================================================

app.post(
  "/api/auth/register",
  async (req, res) => {

    try {

      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Email et mot de passe requis."
        });
      }

      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();

      if (
        password.length < 6
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Le mot de passe doit contenir au moins 6 caractères."
        });
      }

      const existing =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE email = $1
          `,
          [cleanEmail]
        );

      if (
        existing.rows.length > 0
      ) {
        return res.status(409).json({
          success: false,
          error:
            "Ce compte existe déjà."
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO users
            (email, password_hash)
          VALUES
            ($1, $2)
          RETURNING
            id,
            email,
            premium
          `,
          [
            cleanEmail,
            passwordHash
          ]
        );

      const user =
        result.rows[0];

      const token =
        createToken(user);

      res.status(201).json({
        success: true,

        token,

        user: {
          id: user.id,
          email: user.email,
          premium:
            user.premium
        }
      });

    } catch (error) {

      console.error(
        "Register error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de créer le compte."
      });
    }
  }
);

// =====================================================
// LOGIN
// =====================================================

app.post(
  "/api/auth/login",
  async (req, res) => {

    try {

      const {
        email,
        password
      } = req.body;

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Email et mot de passe requis."
        });
      }

      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();

      const result =
        await pool.query(
          `
          SELECT
            id,
            email,
            password_hash,
            premium
          FROM users
          WHERE email = $1
          `,
          [cleanEmail]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(401).json({
          success: false,
          error:
            "Email ou mot de passe incorrect."
        });
      }

      const user =
        result.rows[0];

      const valid =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!valid) {
        return res.status(401).json({
          success: false,
          error:
            "Email ou mot de passe incorrect."
        });
      }

      const token =
        createToken(user);

      res.json({
        success: true,

        token,

        user: {
          id: user.id,
          email: user.email,
          premium:
            user.premium
        }
      });

    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Erreur de connexion."
      });
    }
  }
);

// =====================================================
// CURRENT USER
// =====================================================

app.get(
  "/api/auth/me",
  authenticate,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,
            email,
            premium,
            created_at
          FROM users
          WHERE id = $1
          `,
          [req.user.id]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Utilisateur introuvable."
        });
      }

      res.json({
        success: true,
        user:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "Auth me error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Erreur serveur."
      });
    }
  }
);

// =====================================================
// TASKS
// =====================================================

app.get(
  "/api/tasks",
  authenticate,
  async (req, res) => {

    const result =
      await pool.query(
        `
        SELECT *
        FROM tasks
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

    res.json({
      success: true,
      tasks:
        result.rows
    });
  }
);

app.post(
  "/api/tasks",
  authenticate,
  async (req, res) => {

    const {
      title,
      priority = "medium"
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error:
          "Titre requis."
      });
    }

    const result =
      await pool.query(
        `
        INSERT INTO tasks
          (user_id, title, priority)
        VALUES
          ($1, $2, $3)
        RETURNING *
        `,
        [
          req.user.id,
          title,
          priority
        ]
      );

    res.status(201).json({
      success: true,
      task:
        result.rows[0]
    });
  }
);

app.patch(
  "/api/tasks/:id",
  authenticate,
  async (req, res) => {

    const {
      completed
    } = req.body;

    const result =
      await pool.query(
        `
        UPDATE tasks
        SET completed = $1
        WHERE id = $2
          AND user_id = $3
        RETURNING *
        `,
        [
          Boolean(completed),
          req.params.id,
          req.user.id
        ]
      );

    if (
      result.rows.length === 0
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Tâche introuvable."
      });
    }

    res.json({
      success: true,
      task:
        result.rows[0]
    });
  }
);

app.delete(
  "/api/tasks/:id",
  authenticate,
  async (req, res) => {

    await pool.query(
      `
      DELETE FROM tasks
      WHERE id = $1
        AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id
      ]
    );

    res.json({
      success: true
    });
  }
);

// =====================================================
// PLANNING
// =====================================================

app.get(
  "/api/events",
  authenticate,
  async (req, res) => {

    const result =
      await pool.query(
        `
        SELECT *
        FROM events
        WHERE user_id = $1
        ORDER BY
          event_date ASC,
          event_time ASC
        `,
        [req.user.id]
      );

    res.json({
      success: true,
      events:
        result.rows
    });
  }
);

// Compatibilité frontend
app.get(
  "/api/planning",
  authenticate,
  async (req, res) => {

    const result =
      await pool.query(
        `
        SELECT *
        FROM events
        WHERE user_id = $1
        ORDER BY
          event_date ASC,
          event_time ASC
        `,
        [req.user.id]
      );

    res.json({
      success: true,
      events:
        result.rows
    });
  }
);

app.post(
  "/api/events",
  authenticate,
  async (req, res) => {

    const {
      title,
      eventDate,
      eventTime
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error:
          "Titre requis."
      });
    }

    const result =
      await pool.query(
        `
        INSERT INTO events
          (
            user_id,
            title,
            event_date,
            event_time
          )
        VALUES
          ($1, $2, $3, $4)
        RETURNING *
        `,
        [
          req.user.id,
          title,
          eventDate || null,
          eventTime || null
        ]
      );

    res.status(201).json({
      success: true,
      event:
        result.rows[0]
    });
  }
);

app.delete(
  "/api/events/:id",
  authenticate,
  async (req, res) => {

    await pool.query(
      `
      DELETE FROM events
      WHERE id = $1
        AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id
      ]
    );

    res.json({
      success: true
    });
  }
);

// =====================================================
// NOTES
// =====================================================

app.get(
  "/api/notes",
  authenticate,
  async (req, res) => {

    const result =
      await pool.query(
        `
        SELECT *
        FROM notes
        WHERE user_id = $1
        ORDER BY updated_at DESC
        `,
        [req.user.id]
      );

    res.json({
      success: true,
      notes:
        result.rows
    });
  }
);

app.post(
  "/api/notes",
  authenticate,
  async (req, res) => {

    const {
      title,
      content = ""
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error:
          "Titre requis."
      });
    }

    const result =
      await pool.query(
        `
        INSERT INTO notes
          (
            user_id,
            title,
            content
          )
        VALUES
          ($1, $2, $3)
        RETURNING *
        `,
        [
          req.user.id,
          title,
          content
        ]
      );

    res.status(201).json({
      success: true,
      note:
        result.rows[0]
    });
  }
);

app.delete(
  "/api/notes/:id",
  authenticate,
  async (req, res) => {

    await pool.query(
      `
      DELETE FROM notes
      WHERE id = $1
        AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id
      ]
    );

    res.json({
      success: true
    });
  }
);

// =====================================================
// BUDGET
// =====================================================

app.get(
  "/api/budget",
  authenticate,
  async (req, res) => {

    const result =
      await pool.query(
        `
        SELECT *
        FROM budgets
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

    res.json({
      success: true,
      budgets:
        result.rows
    });
  }
);

app.post(
  "/api/budget",
  authenticate,
  async (req, res) => {

    const {
      description,
      amount,
      type
    } = req.body;

    if (
      !description ||
      amount === undefined ||
      ![
        "income",
        "expense"
      ].includes(type)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Données de budget invalides."
      });
    }

    const result =
      await pool.query(
        `
        INSERT INTO budgets
          (
            user_id,
            description,
            amount,
             type
          ]
        );

    res.status(201).json({
      success: true,
      budget:
        result.rows[0]
    });
  }
);

app.delete(
  "/api/budget/:id",
  authenticate,
  async (req, res) => {

    await pool.query(
      `
      DELETE FROM budgets
      WHERE id = $1
        AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id
      ]
    );

    res.json({
      success: true
    });
  }
);

// =====================================================
// GOALS
// =====================================================

app.get(
  "/api/goals",
  authenticate,
  async (req, res) => {

    const result =
      await pool.query(
        `
        SELECT *
        FROM goals
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

    res.json({
      success: true,
      goals:
        result.rows
    });
  }
);

app.post(
  "/api/goals",
  authenticate,
  async (req, res) => {

    const {
      title,
      target,
      progress = 0
    } = req.body;

    if (
      !title ||
      !target ||
      Number(target) < 1
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Objectif invalide."
      });
    }

    const result =
      await pool.query(
        `
        INSERT INTO goals
          (
            user_id,
            title,
            target,
            progress
          )
        VALUES
          ($1, $2, $3, $4)
        RETURNING *
        `,
        [
          req.user.id,
          title,
          Number(target),
          Number(progress) || 0
        ]
      );

    res.status(201).json({
      success: true,
      goal:
        result.rows[0]
    });
  }
);

app.patch(
  "/api/goals/:id",
  authenticate,
  async (req, res) => {

    const {
      progress,
      increment
    } = req.body;

    let newProgress;

    if (
      increment !== undefined
    ) {

      const current =
        await pool.query(
          `
          SELECT progress
          FROM goals
          WHERE id = $1
            AND user_id = $2
          `,
          [
            req.params.id,
            req.user.id
          ]
        );

      if (
        current.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Objectif introuvable."
        });
      }

      newProgress =
        Number(
          current.rows[0].progress
        ) +
        Number(increment || 0);

    } else {

      newProgress =
        Number(progress) || 0;
    }

    const result =
      await pool.query(
        `
        UPDATE goals
        SET progress = GREATEST(0, $1)
        WHERE id = $2
          AND user_id = $3
        RETURNING *
        `,
        [
          newProgress,
          req.params.id,
          req.user.id
        ]
      );

    if (
      result.rows.length === 0
    ) {
      return res.status(404).json({
        success: false,
        error:
          "Objectif introuvable."
      });
    }

    res.json({
      success: true,
      goal:
        result.rows[0]
    });
  }
);

app.delete(
  "/api/goals/:id",
  authenticate,
  async (req, res) => {

    await pool.query(
      `
      DELETE FROM goals
      WHERE id = $1
        AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id
      ]
    );

    res.json({
      success: true
    });
  }
);

// =====================================================
// PREMIUM STATUS
// =====================================================

app.get(
  "/api/subscription/status",
  authenticate,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            u.premium,
            s.status,
            s.plan,
            s.expires_at,
            s.provider,
            s.provider_subscription_id

          FROM users u

          LEFT JOIN subscriptions s
            ON s.user_id = u.id

          WHERE u.id = $1

          ORDER BY s.id DESC

          LIMIT 1
          `,
          [req.user.id]
        );

      const user =
        result.rows[0];

      res.json({
        success: true,

        premium:
          user?.premium === true,

        subscription: {
          status:
            user?.status ||
            "inactive",

          plan:
            user?.plan ||
            null,

          expiresAt:
            user?.expires_at ||
            null,

          provider:
            user?.provider ||
            null,

          providerSubscriptionId:
            user?.provider_subscription_id ||
            null
        }
      });

    } catch (error) {

      console.error(
        "Subscription status error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de récupérer Premium."
      });
    }
  }
);

// =====================================================
// PREMIUM PAYMENT - TCHOTCHOM
// =====================================================

app.post(
  "/api/subscription/create",
  authenticate,
  async (req, res) => {

    try {

      // Vérification de la configuration
      if (
        !TCHOTCHOM_API_KEY ||
        !TCHOTCHOM_SECRET_KEY ||
        !TCHOTCHOM_PAYEE_EMAIL
      ) {

        return res.status(503).json({
          success: false,
          paymentReady: false,
          error:
            "Tchotchom n'est pas complètement configuré dans Render."
        });
      }

      // Données reçues du frontend
      const amount =
        Number(req.body.amount);

      const currency =
        String(
          req.body.currency ||
          "HTG"
        ).toUpperCase();

      const paymentMethod =
        String(
          req.body.paymentMethod ||
          "moncash"
        ).toLowerCase();

      // Validation du montant
      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {

        return res.status(400).json({
          success: false,
          paymentReady: false,
          error:
            "Montant de paiement invalide."
        });
      }

      // Validation devise
      if (
        !["HTG", "USD"].includes(
          currency
        )
      ) {

        return res.status(400).json({
          success: false,
          paymentReady: false,
          error:
            "Devise non supportée."
        });
      }

      // Validation moyen de paiement
      if (
        ![
          "moncash",
          "card"
        ].includes(paymentMethod)
      ) {

        return res.status(400).json({
          success: false,
          paymentReady: false,
          error:
            "Méthode de paiement non supportée."
        });
      }

      // Référence unique
      const reference =
        `LUMIO-${req.user.id}-${Date.now()}`;

      const description =
        "Abonnement Lumio Premium";

      // =================================================
      // APPEL TCHOTCHOM
      // =================================================

      const tchotchomResponse =
        await fetch(
          `${TCHOTCHOM_BASE_URL}/payments`,
          {
            method: "POST",

            headers:
              getTchotchomHeaders(),

            body:
              JSON.stringify({

                amount:

                  amount,

                currency:

                  currency,

                payee_email:

                  TCHOTCHOM_PAYEE_EMAIL,

                description:

                  description,

                reference:

                  reference,

                payment_method:

                  paymentMethod
              })
          }
        );

      // Lire la réponse
      let data = null;

      try {

        data =
          await tchotchomResponse.json();

      } catch {

        data = null;
      }

      console.log(
        "Tchotchom HTTP:",
        tchotchomResponse.status
      );

      console.log(
        "Tchotchom response:",
        data
      );

      // Tchotchom a refusé
      if (
        !tchotchomResponse.ok
      ) {

        const errorMessage =
          data?.message ||
          data?.error ||
          data?.errors?.[0]?.message ||
          `Tchotchom a retourné HTTP ${tchotchomResponse.status}.`;

        return res.status(
          tchotchomResponse.status
        ).json({
          success: false,
          paymentReady: false,
          error:
            errorMessage
        });
      }

      // Récupérer le paiement
      const payment =
        data?.data ||
        data?.payment ||
        data;

      if (!payment) {

        return res.status(502).json({
          success: false,
          paymentReady: false,
          error:
            "Réponse Tchotchom invalide."
        });
      }

      const providerPaymentId =
        payment?.id
          ? String(payment.id)
          : null;

      const providerReference =
        payment?.reference ||
        reference;

      const providerStatus =
        String(
          payment?.status ||
          "pending"
        ).toLowerCase();

      // =================================================
      // SAUVEGARDER LE PAIEMENT
      // =================================================

      const paymentResult =
        await pool.query(
          `
          INSERT INTO payments
            (
              user_id,
              provider,
              provider_payment_id,
              reference,
              amount,
              currency,
              payment_method,
              status,
              raw_response
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9
            )
          RETURNING *
          `,
          [
            req.user.id,
            "tchotchom",
            providerPaymentId,
            providerReference,
            amount,
            currency,
            paymentMethod,
            providerStatus,
            JSON.stringify(data)
          ]
        );

      // =================================================
      // SI LE PAIEMENT EST DÉJÀ CONFIRMÉ
      // =================================================

      const successfulStatuses = [
        "completed",
        "complete",
        "paid",
        "success",
        "successful"
      ];

      const paymentCompleted =
        successfulStatuses.includes(
          providerStatus
        );

      if (paymentCompleted) {

        const startedAt =
          new Date();

        const expiresAt =
          new Date();

        // Premium valable 30 jours
        expiresAt.setDate(
          expiresAt.getDate() + 30
        );

        await pool.query(
          `
          UPDATE users
          SET premium = TRUE
          WHERE id = $1
          `,
          [req.user.id]
        );

        await pool.query(
          `
          INSERT INTO subscriptions
            (
              user_id,
              status,
              plan,
              provider,
              provider_subscription_id,
              started_at,
              expires_at,
              updated_at
            )
          VALUES
            (
              $1,
              'active',
              'premium_monthly',
              'tchotchom',
              $2,
              $3,
              $4,
              CURRENT_TIMESTAMP
            )
          `,
          [
            req.user.id,
            providerPaymentId,
            startedAt,
            expiresAt
          ]
        );
      }

      // =================================================
      // RÉPONSE AU FRONTEND
      // =================================================

      return res.status(201).json({

        success: true,

        paymentReady: true,

        payment: {

          id:
            providerPaymentId,

          amount:
            amount,

          currency:
            currency,

          status:
            providerStatus,

          reference:
            providerReference,

          paymentMethod:
            payment?.payment_method ||
            paymentMethod
        },

        premiumActivated:
          paymentCompleted,

        databasePaymentId:
          paymentResult.rows[0].id
      });

    } catch (error) {

      console.error(
        "Erreur Premium/Tchotchom:",
        error
      );

      return res.status(500).json({
        success: false,
        paymentReady: false,
        error:
          "Impossible de créer le paiement Premium."
      });
    }
  }
);

// =====================================================
// HISTORIQUE DES PAIEMENTS
// =====================================================

app.get(
  "/api/payments",
  authenticate,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            id,
            provider,
            provider_payment_id,
            reference,
            amount,
            currency,
            payment_method,
            status,
            created_at
          FROM payments
          WHERE user_id = $1
          ORDER BY created_at DESC
          `,
          [req.user.id]
        );

      res.json({
        success: true,
        payments:
          result.rows
      });

    } catch (error) {

      console.error(
        "Payment history error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de récupérer les paiements."
      });
    }
  }
);

// =====================================================
// ROUTE 404
// =====================================================

app.use(
  (req, res) => {

    res.status(404).json({
      success: false,
      error:
        "Resource not found"
    });
  }
);

// =====================================================
// ERREUR SERVEUR
// =====================================================

app.use(
  (error, req, res, next) => {

    console.error(
      "Unhandled error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Erreur interne du serveur."
    });
  }
);

// =====================================================
// START SERVER
// =====================================================

async function startServer() {

  try {

    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `Lumio Backend 4.0.0 running on port ${PORT}`
        );

      }
    );

  } catch (error) {

    console.error(
      "Impossible de démarrer Lumio:",
      error
    );

    process.exit(1);
  }
}

startServer();
