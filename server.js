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
  process.env.TCHOTCHOM_API_KEY || "";

const TCHOTCHOM_SECRET_KEY =
  process.env.TCHOTCHOM_SECRET_KEY || "";

const TCHOTCHOM_PAYEE_EMAIL =
  process.env.TCHOTCHOM_PAYEE_EMAIL || "";

/*
  IMPORTANT :

  Mets ici l'URL EXACTE fournie par Tchotchom/SBFast
  pour créer un paiement.

  Exemple dans Render :

  TCHOTCHOM_PAYMENT_URL=https://...

  On ne fabrique pas cette URL automatiquement,
  car une mauvaise route provoque "Resource not found".
*/

const TCHOTCHOM_PAYMENT_URL =
  process.env.TCHOTCHOM_PAYMENT_URL || "";


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

  pool.on(
    "error",
    (error) => {
      console.error(
        "PostgreSQL error:",
        error
      );
    }
  );

} else {

  console.error(
    "DATABASE_URL manque."
  );
}


// =====================================================
// AUTHENTIFICATION
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
// DATABASE
// =====================================================

async function initializeDatabase() {

  if (!pool) {

    throw new Error(
      "DATABASE_URL non configurée."
    );
  }


  // USERS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (

      id SERIAL PRIMARY KEY,

      email VARCHAR(255)
        UNIQUE NOT NULL,

      password_hash TEXT
        NOT NULL,

      premium BOOLEAN
        DEFAULT FALSE,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);


  // SUBSCRIPTIONS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (

      id SERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
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


  // PAYMENTS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (

      id SERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
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


  // TASKS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (

      id SERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
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


  // EVENTS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (

      id SERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
        ON DELETE CASCADE,

      title TEXT NOT NULL,

      event_date DATE,

      event_time TIME,

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);


  // NOTES
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (

      id SERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
        ON DELETE CASCADE,

      title TEXT NOT NULL,

      content TEXT
        DEFAULT '',

      created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

      updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
    );
  `);


  // BUDGET
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (

      id SERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
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


  // GOALS
  await pool.query(`
    CREATE TABLE IF NOT EXISTS goals (

      id SERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
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

      app:
        "Lumio",

      backend:
        "online",

      database,

      version:
        "5.0.0",

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

      success:
        true,

      backend:
        "online",

      database,

      version:
        "5.0.0",

      tchotchomConfigured:
        Boolean(
          TCHOTCHOM_API_KEY &&
          TCHOTCHOM_SECRET_KEY &&
          TCHOTCHOM_PAYEE_EMAIL
        ),

      paymentUrlConfigured:
        Boolean(
          TCHOTCHOM_PAYMENT_URL
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

          success:
            false,

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

          success:
            false,

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

          success:
            false,

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
            (
              email,
              password_hash
            )
          VALUES
            (
              $1,
              $2
            )
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

        success:
          true,

        token,

        user: {

          id:
            user.id,

          email:
            user.email,

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

        success:
          false,

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

          success:
            false,

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

          success:
            false,

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

          success:
            false,

          error:
            "Email ou mot de passe incorrect."
        });
      }


      const token =
        createToken(user);


      res.json({

        success:
          true,

        token,

        user: {

          id:
            user.id,

          email:
            user.email,

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

        success:
          false,

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

          success:
            false,

          error:
            "Utilisateur introuvable."
        });
      }


      res.json({

        success:
          true,

        user:
          result.rows[0]
      });


    } catch (error) {

      console.error(
        "Auth me error:",
        error
      );


      res.status(500).json({

        success:
          false,

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

      success:
        true,

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

        success:
          false,

        error:
          "Titre requis."
      });
    }


    const allowedPriorities = [
      "low",
      "medium",
      "high"
    ];


    const cleanPriority =
      allowedPriorities.includes(
        priority
      )
        ? priority
        : "medium";


    const result =
      await pool.query(
        `
        INSERT INTO tasks
          (
            user_id,
            title,
            priority
          )
        VALUES
          (
            $1,
            $2,
            $3
          )
        RETURNING *
        `,
        [
          req.user.id,
          String(title).trim(),
          cleanPriority
        ]
      );


    res.status(201).json({

      success:
        true,

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

        success:
          false,

        error:
          "Tâche introuvable."
      });
    }


    res.json({

      success:
        true,

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

      success:
        true
    });
  }
);


// =====================================================
// PLANNING
// =====================================================

async function getEvents(
  userId
) {

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
      [userId]
    );


  return result.rows;
}


app.get(
  "/api/events",
  authenticate,
  async (req, res) => {

    const events =
      await getEvents(
        req.user.id
      );


    res.json({

      success:
        true,

      events
    });
  }
);


// Compatibilité avec ton frontend
app.get(
  "/api/planning",
  authenticate,
  async (req, res) => {

    const events =
      await getEvents(
        req.user.id
      );


    res.json({

      success:
        true,

      events
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

        success:
          false,

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
          (
            $1,
            $2,
            $3,
            $4
          )

        RETURNING *
        `,
        [
          req.user.id,
          String(title).trim(),
          eventDate || null,
          eventTime || null
        ]
      );


    res.status(201).json({

      success:
        true,

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

      success:
        true
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

        ORDER BY
          updated_at DESC
        `,
        [req.user.id]
      );


    res.json({

      success:
        true,

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

        success:
          false,

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
          (
            $1,
            $2,
            $3
          )

        RETURNING *
        `,
        [
          req.user.id,
          String(title).trim(),
          String(content)
        ]
      );


    res.status(201).json({

      success:
        true,

      note:
        result.rows[0]
    });
  }
);


app.delete(
  "/api/notes/:id",
  authenticate,
  async (req, res) => {

    try {

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

    } catch (error) {

      console.error(
        "Delete note error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de supprimer la note."
      });
    }
  }
);


// =====================================================
// BUDGET
// =====================================================

app.get(
  "/api/budget",
  authenticate,
  async (req, res) => {

    try {

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
        budgets: result.rows
      });

    } catch (error) {

      console.error(
        "Load budget error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de charger le budget."
      });
    }
  }
);


app.post(
  "/api/budget",
  authenticate,
  async (req, res) => {

    try {

      const {
        description,
        amount,
        type
      } = req.body;

      const cleanDescription =
        String(description || "").trim();

      const cleanAmount =
        Number(amount);

      if (
        !cleanDescription ||
        !Number.isFinite(cleanAmount) ||
        cleanAmount <= 0 ||
        !["income", "expense"].includes(type)
      ) {

        return res.status(400).json({
          success: false,
          error: "Données de budget invalides."
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
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4
            )
          RETURNING *
          `,
          [
            req.user.id,
            cleanDescription,
            cleanAmount,
            type
          ]
        );

      res.status(201).json({
        success: true,
        budget: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Create budget error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible d'ajouter cette opération."
      });
    }
  }
);


app.delete(
  "/api/budget/:id",
  authenticate,
  async (req, res) => {

    try {

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

    } catch (error) {

      console.error(
        "Delete budget error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de supprimer l'opération."
      });
    }
  }
);


// =====================================================
// BUDGET SUMMARY
// =====================================================

app.get(
  "/api/budget/summary",
  authenticate,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN type = 'income'
                  THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS income,

            COALESCE(
              SUM(
                CASE
                  WHEN type = 'expense'
                  THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS expense

          FROM budgets

          WHERE user_id = $1
          `,
          [req.user.id]
        );

      const income =
        Number(result.rows[0]?.income || 0);

      const expense =
        Number(result.rows[0]?.expense || 0);

      res.json({
        success: true,
        income,
        expense,
        balance: income - expense
      });

    } catch (error) {

      console.error(
        "Budget summary error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de calculer le budget."
      });
    }
  }
);


// =====================================================
// OBJECTIFS
// =====================================================

app.get(
  "/api/goals",
  authenticate,
  async (req, res) => {

    try {

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
        goals: result.rows
      });

    } catch (error) {

      console.error(
        "Load goals error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de charger les objectifs."
      });
    }
  }
);


app.post(
  "/api/goals",
  authenticate,
  async (req, res) => {

    try {

      const {
        title,
        target
      } = req.body;

      const cleanTitle =
        String(title || "").trim();

      const cleanTarget =
        Number(target);

      if (
        !cleanTitle ||
        !Number.isFinite(cleanTarget) ||
        cleanTarget <= 0
      ) {

        return res.status(400).json({
          success: false,
          error: "Objectif invalide."
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
            (
              $1,
              $2,
              $3,
              0
            )
          RETURNING *
          `,
          [
            req.user.id,
            cleanTitle,
            Math.round(cleanTarget)
          ]
        );

      res.status(201).json({
        success: true,
        goal: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Create goal error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de créer l'objectif."
      });
    }
  }
);


app.patch(
  "/api/goals/:id",
  authenticate,
  async (req, res) => {

    try {

      /*
        Le frontend peut envoyer :

        {
          "increment": 1
        }

        OU :

        {
          "progress": 5
        }
      */

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
            SELECT progress, target
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
            error: "Objectif introuvable."
          });
        }

        newProgress =
          Number(
            current.rows[0].progress || 0
          ) +
          Number(increment || 0);

        newProgress =
          Math.max(
            0,
            Math.min(
              newProgress,
              Number(
                current.rows[0].target
              )
            )
          );

      } else {

        newProgress =
          Number(progress);

        if (
          !Number.isFinite(
            newProgress
          )
        ) {

          return res.status(400).json({
            success: false,
            error: "Progression invalide."
          });
        }

        newProgress =
          Math.max(
            0,
            Math.round(newProgress)
          );
      }

      const result =
        await pool.query(
          `
          UPDATE goals
          SET progress = $1
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
          error: "Objectif introuvable."
        });
      }

      res.json({
        success: true,
        goal: result.rows[0]
      });

    } catch (error) {

      console.error(
        "Update goal error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de modifier l'objectif."
      });
    }
  }
);


app.delete(
  "/api/goals/:id",
  authenticate,
  async (req, res) => {

    try {

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

    } catch (error) {

      console.error(
        "Delete goal error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de supprimer l'objectif."
      });
    }
  }
);


// =====================================================
// PREMIUM — STATUT
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

            s.provider,

            s.provider_customer_id,

            s.provider_subscription_id,

            s.started_at,

            s.expires_at

          FROM users u

          LEFT JOIN subscriptions s
            ON s.user_id = u.id

          WHERE u.id = $1

          ORDER BY s.id DESC

          LIMIT 1
          `,
          [req.user.id]
        );

      const row =
        result.rows[0] || {};

      res.json({

        success: true,

        premium:
          row.premium === true,

        subscription: {

          status:
            row.status || "inactive",

          plan:
            row.plan || null,

          provider:
            row.provider || null,

          providerCustomerId:
            row.provider_customer_id || null,

          providerSubscriptionId:
            row.provider_subscription_id || null,

          startedAt:
            row.started_at || null,

          expiresAt:
            row.expires_at || null
        }
      });

    } catch (error) {

      console.error(
        "Subscription status error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Impossible de récupérer Premium."
      });
    }
  }
);


// =====================================================
// PREMIUM — CRÉATION DU PAIEMENT
// =====================================================

app.post(
  "/api/subscription/create",
  authenticate,
  async (req, res) => {

    try {

      const {
        amount,
        currency = "HTG",
        paymentMethod = "moncash"
      } = req.body;

      const cleanAmount =
        Number(amount);

      const cleanMethod =
        String(
          paymentMethod || ""
        ).toLowerCase();

      if (
        !Number.isFinite(cleanAmount) ||
        cleanAmount <= 0
      ) {

        return res.status(400).json({
          success: false,
          paymentReady: false,
          error: "Montant invalide."
        });
      }

      const allowedMethods = [
        "moncash",
        "tchotchom"
      ];

      if (
        !allowedMethods.includes(
          cleanMethod
        )
      ) {

        return res.status(400).json({
          success: false,
          paymentReady: false,
          error: "Méthode de paiement invalide."
        });
      }


      /*
        IMPORTANT :

        Cette route ne donne PAS Premium
        automatiquement.

        Premium sera activé seulement
        après confirmation réelle du paiement.
      */


      if (
        !TCHOTCHOM_API_KEY ||
        !TCHOTCHOM_SECRET_KEY ||
        !TCHOTCHOM_PAYEE_EMAIL
      ) {

        return res.status(503).json({

          success: false,

          paymentReady: false,

          error:
            "Le paiement n'est pas encore configuré côté serveur."
        });
      }


      if (
        !TCHOTCHOM_PAYMENT_URL
      ) {

        return res.status(503).json({

          success: false,

          paymentReady: false,

          error:
            "L'URL de paiement Tchotchom manque dans Render."
        });
      }


      /*
        Référence unique Lumio.

        Elle permet de retrouver
        le paiement dans la base.
      */

      const reference =
        "LUMIO-" +
        Date.now() +
        "-" +
        req.user.id;


      /*
        On enregistre d'abord
        le paiement comme pending.
      */

      const inserted =
        await pool.query(
          `
          INSERT INTO payments
            (
              user_id,
              provider,
              reference,
              amount,
              currency,
              payment_method,
              status
            )

          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              'pending'
            )

          RETURNING *
          `,
          [
            req.user.id,
            cleanMethod,
            reference,
            cleanAmount,
            currency,
            cleanMethod
          ]
        );


      /*
        Si Tchotchom fournit une URL
        de paiement hébergée, on peut
        la renvoyer au frontend.

        Le serveur ne fabrique jamais
        une fausse URL.
      */

      let paymentUrl =
        null;


      /*
        Si TCHOTCHOM_PAYMENT_URL
        correspond à une page de paiement
        déjà configurée chez le fournisseur,
        on la retourne avec les informations
        Lumio.

        NOTE :
        le frontend ne doit pas considérer
        cela comme un paiement réussi.
      */

      try {

        const url =
          new URL(
            TCHOTCHOM_PAYMENT_URL
          );

        url.searchParams.set(
          "reference",
          reference
        );

        url.searchParams.set(
          "amount",
          String(cleanAmount)
        );

        url.searchParams.set(
          "currency",
          String(currency)
        );

        url.searchParams.set(
          "email",
          TCHOTCHOM_PAYEE_EMAIL
        );

        paymentUrl =
          url.toString();

      } catch {

        return res.status(500).json({

          success: false,

          paymentReady: false,

          error:
            "TCHOTCHOM_PAYMENT_URL est invalide."
        });
      }


      res.status(201).json({

        success: true,

        paymentReady: true,

        payment: {

          id:
            inserted.rows[0].id,

          reference,

          amount:
            cleanAmount,

          currency,

          paymentMethod:
            cleanMethod,

          status:
            "pending",

          paymentUrl
        }
      });

    } catch (error) {

      console.error(
        "Create payment error:",
        error
      );

      res.status(500).json({

        success: false,

        paymentReady: false,

        error:
          "Impossible de créer le paiement."
      });
    }
  }
);


// =====================================================
// PREMIUM — LISTE DES PAIEMENTS DE L'UTILISATEUR
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
            created_at,
            updated_at

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
        "Payments error:",
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
// PREMIUM — VÉRIFICATION DU PAIEMENT
// =====================================================

app.get(
  "/api/subscription/payment/:reference",
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
            created_at,
            updated_at

          FROM payments

          WHERE reference = $1
            AND user_id = $2

          LIMIT 1
          `,
          [
            req.params.reference,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          error:
            "Paiement introuvable."
        });
      }


      const payment =
        result.rows[0];


      res.json({

        success: true,

        paid:
          payment.status === "paid",

        payment
      });

    } catch (error) {

      console.error(
        "Payment status error:",
        error
      );

      res.status(500).json({

        success: false,

        error:
          "Impossible de vérifier le paiement."
      });
    }
  }
);


// =====================================================
// PREMIUM — ACTIVATION INTERNE
// =====================================================

/*
  Cette route est volontairement protégée
  par une clé serveur.

  Elle sert au webhook/provider
  pour confirmer un paiement.

  NE PAS appeler cette route depuis
  le frontend.
*/

app.post(
  "/api/internal/payment/confirm",
  async (req, res) => {

    try {

      const internalKey =
        process.env.INTERNAL_PAYMENT_KEY;

      const receivedKey =
        req.headers["x-internal-key"];

      if (
        !internalKey ||
        receivedKey !== internalKey
      ) {

        return res.status(401).json({

          success: false,

          error:
            "Non autorisé."
        });
      }


      const {
        reference,
        providerPaymentId,
        status
      } = req.body;


      if (
        !reference
      ) {

        return res.status(400).json({

          success: false,

          error:
            "Référence requise."
        });
      }


      const normalizedStatus =
        String(
          status || ""
        ).toLowerCase();


      if (
        normalizedStatus !== "paid"
      ) {

        await pool.query(
          `
          UPDATE payments

          SET
            status = $1,
            provider_payment_id = COALESCE(
              $2,
              provider_payment_id
            ),
            updated_at = CURRENT_TIMESTAMP

          WHERE reference = $3
          `,
          [
            normalizedStatus || "failed",
            providerPaymentId || null,
            reference
          ]
        );

                return res.json({
          success: true,
          updated: true,
          status: normalizedStatus || "failed"
        });
      }


      // =================================================
      // PAIEMENT CONFIRMÉ
      // =================================================

      const paymentResult =
        await pool.query(
          `
          UPDATE payments

          SET
            status = 'paid',

            provider_payment_id =
              COALESCE(
                $1,
                provider_payment_id
              ),

            updated_at =
              CURRENT_TIMESTAMP

          WHERE reference = $2

          RETURNING
            *
          `,
          [
            providerPaymentId || null,
            reference
          ]
        );


      if (
        paymentResult.rows.length === 0
      ) {

        return res.status(404).json({
          success: false,
          error:
            "Paiement introuvable."
        });
      }


      const payment =
        paymentResult.rows[0];


      // =================================================
      // ACTIVATION PREMIUM
      // =================================================

      const startedAt =
        new Date();


      const expiresAt =
        new Date(
          startedAt.getTime() +
          30 * 24 * 60 * 60 * 1000
        );


      await pool.query(
        `
        UPDATE users

        SET premium = TRUE

        WHERE id = $1
        `,
        [
          payment.user_id
        ]
      );


      // =================================================
      // CRÉATION / MISE À JOUR ABONNEMENT
      // =================================================

      await pool.query(
        `
        INSERT INTO subscriptions
          (
            user_id,
            status,
            plan,
            provider,
            provider_customer_id,
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
            $2,
            NULL,
            $3,
            $4,
            $5,
            CURRENT_TIMESTAMP
          )

        `,
        [
          payment.user_id,
          payment.provider,
          providerPaymentId || null,
          startedAt,
          expiresAt
        ]
      );


      return res.json({
        success: true,
        premium: true,
        status: "paid",
        expiresAt
      });


    } catch (error) {

      console.error(
        "Internal payment confirmation error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Impossible de confirmer le paiement."
      });
    }
  }
);


// =====================================================
// PREMIUM — ANNULATION D'UN PAIEMENT
// =====================================================

app.post(
  "/api/subscription/payment/:reference/cancel",
  authenticate,
  async (req, res) => {

    try {

      const result =
        await pool.query(
          `
          UPDATE payments

          SET
            status = 'cancelled',
            updated_at =
              CURRENT_TIMESTAMP

          WHERE reference = $1
            AND user_id = $2
            AND status = 'pending'

          RETURNING *
          `,
          [
            req.params.reference,
            req.user.id
          ]
        );


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({
          success: false,
          error:
            "Paiement en attente introuvable."
        });
      }


      res.json({
        success: true,
        payment:
          result.rows[0]
      });


    } catch (error) {

      console.error(
        "Cancel payment error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible d'annuler le paiement."
      });
    }
  }
);


// =====================================================
// PREMIUM — EXPIRATION AUTOMATIQUE
// =====================================================

async function refreshExpiredSubscriptions() {

  if (!pool) {
    return;
  }


  try {

    const expired =
      await pool.query(
        `
        SELECT
          id,
          user_id

        FROM subscriptions

        WHERE status = 'active'

          AND expires_at IS NOT NULL

          AND expires_at <= CURRENT_TIMESTAMP
        `
      );


    for (
      const subscription
      of expired.rows
    ) {

      await pool.query(
        `
        UPDATE subscriptions

        SET
          status = 'expired',
          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = $1
        `,
        [
          subscription.id
        ]
      );


      /*
        Vérifie s'il existe
        encore un abonnement actif.
      */

      const active =
        await pool.query(
          `
          SELECT id

          FROM subscriptions

          WHERE user_id = $1

            AND status = 'active'

            AND (
              expires_at IS NULL
              OR expires_at > CURRENT_TIMESTAMP
            )

          LIMIT 1
          `,
          [
            subscription.user_id
          ]
        );


      if (
        active.rows.length === 0
      ) {

        await pool.query(
          `
          UPDATE users

          SET premium = FALSE

          WHERE id = $1
          `,
          [
            subscription.user_id
          ]
        );
      }
    }


  } catch (error) {

    console.error(
      "Subscription expiration error:",
      error
    );
  }
}


// =====================================================
// PREMIUM — VÉRIFICATION MANUELLE
// =====================================================

app.post(
  "/api/subscription/refresh",
  authenticate,
  async (req, res) => {

    try {

      await refreshExpiredSubscriptions();


      const result =
        await pool.query(
          `
          SELECT
            u.premium,

            s.status,

            s.plan,

            s.provider,

            s.started_at,

            s.expires_at

          FROM users u

          LEFT JOIN subscriptions s
            ON s.user_id = u.id

          WHERE u.id = $1

          ORDER BY s.id DESC

          LIMIT 1
          `,
          [
            req.user.id
          ]
        );


      const row =
        result.rows[0] || {};


      res.json({

        success: true,

        premium:
          row.premium === true,

        subscription: {

          status:
            row.status || "inactive",

          plan:
            row.plan || null,

          provider:
            row.provider || null,

          startedAt:
            row.started_at || null,

          expiresAt:
            row.expires_at || null
        }
      });


    } catch (error) {

      console.error(
        "Refresh subscription error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de vérifier Premium."
      });
    }
  }
);


// =====================================================
// FOCUS
// =====================================================

/*
  Le minuteur Focus fonctionne principalement
  côté frontend.

  Cette route permet simplement de sauvegarder
  les minutes réalisées par l'utilisateur.
*/


app.post(
  "/api/focus/session",
  authenticate,
  async (req, res) => {

    try {

      const minutes =
        Number(
          req.body.minutes
        );


      if (
        !Number.isFinite(minutes) ||
        minutes <= 0
      ) {

        return res.status(400).json({
          success: false,
          error:
            "Nombre de minutes invalide."
        });
      }


      /*
        On crée la table si elle n'existe pas.
      */

      await pool.query(`
        CREATE TABLE IF NOT EXISTS focus_sessions (

          id SERIAL PRIMARY KEY,

          user_id INTEGER
            REFERENCES users(id)
            ON DELETE CASCADE,

          minutes INTEGER
            NOT NULL,

          created_at TIMESTAMP
            DEFAULT CURRENT_TIMESTAMP
        );
      `);


      const result =
        await pool.query(
          `
          INSERT INTO focus_sessions
            (
              user_id,
              minutes
            )

          VALUES
            (
              $1,
              $2
            )

          RETURNING *
          `,
          [
            req.user.id,
            Math.round(minutes)
          ]
        );


      res.status(201).json({
        success: true,
        session:
          result.rows[0]
      });


    } catch (error) {

      console.error(
        "Focus session error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible d'enregistrer la session Focus."
      });
    }
  }
);


app.get(
  "/api/focus/stats",
  authenticate,
  async (req, res) => {

    try {

      await pool.query(`
        CREATE TABLE IF NOT EXISTS focus_sessions (

          id SERIAL PRIMARY KEY,

          user_id INTEGER
            REFERENCES users(id)
            ON DELETE CASCADE,

          minutes INTEGER
            NOT NULL,

          created_at TIMESTAMP
            DEFAULT CURRENT_TIMESTAMP
        );
      `);


      const result =
        await pool.query(
          `
          SELECT
            COALESCE(
              SUM(minutes),
              0
            ) AS total_minutes,

            COUNT(*) AS sessions

          FROM focus_sessions

          WHERE user_id = $1
          `,
          [
            req.user.id
          ]
        );


      res.json({

        success: true,

        totalMinutes:
          Number(
            result.rows[0]?.total_minutes || 0
          ),

        sessions:
          Number(
            result.rows[0]?.sessions || 0
          )
      });


    } catch (error) {

      console.error(
        "Focus stats error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de récupérer les statistiques Focus."
      });
    }
  }
);


// =====================================================
// DASHBOARD
// =====================================================

app.get(
  "/api/dashboard",
  authenticate,
  async (req, res) => {

    try {

      const tasks =
        await pool.query(
          `
          SELECT
            COUNT(*) FILTER (
              WHERE completed = FALSE
            ) AS remaining,

            COUNT(*) AS total

          FROM tasks

          WHERE user_id = $1
          `,
          [
            req.user.id
          ]
        );


      const goals =
        await pool.query(
          `
          SELECT
            COUNT(*) AS total,

            COALESCE(
              SUM(progress),
              0
            ) AS progress,

            COALESCE(
              SUM(target),
              0
            ) AS target

          FROM goals

          WHERE user_id = $1
          `,
          [
            req.user.id
          ]
        );


      const budget =
        await pool.query(
          `
          SELECT

            COALESCE(
              SUM(
                CASE
                  WHEN type = 'income'
                  THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS income,

            COALESCE(
              SUM(
                CASE
                  WHEN type = 'expense'
                  THEN amount
                  ELSE 0
                END
              ),
              0
            ) AS expense

          FROM budgets

          WHERE user_id = $1
          `,
          [
            req.user.id
          ]
        );


      const user =
        await pool.query(
          `
          SELECT
            id,
            email,
            premium

          FROM users

          WHERE id = $1
          `,
          [
            req.user.id
          ]
        );


      const taskData =
        tasks.rows[0] || {};

      const goalData =
        goals.rows[0] || {};

      const budgetData =
        budget.rows[0] || {};

      const income =
        Number(
          budgetData.income || 0
        );

      const expense =
        Number(
          budgetData.expense || 0
        );

      const target =
        Number(
          goalData.target || 0
        );

      const progress =
        Number(
          goalData.progress || 0
        );


      let goalPercentage = 0;


      if (target > 0) {

        goalPercentage =
          Math.round(
            Math.min(
              100,
              (progress / target) * 100
            )
          );
      }


      res.json({

        success: true,

        user:
          user.rows[0] || null,

        tasks: {

          remaining:
            Number(
              taskData.remaining || 0
            ),

          total:
            Number(
              taskData.total || 0
            )
        },

        goals: {

          total:
            Number(
              goalData.total || 0
            ),

          progress,

          target,

          percentage:
            goalPercentage
        },

        budget: {

          income,

          expense,

          balance:
            income - expense
        }
      });


    } catch (error) {

      console.error(
        "Dashboard error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Impossible de charger le tableau de bord."
      });
    }
  }
);


// =====================================================
// 404 API
// =====================================================

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({

      success: false,

      error:
        "Route API introuvable."
    });
  }
);


// =====================================================
// ERREUR GÉNÉRALE
// =====================================================

app.use(
  (error, req, res, next) => {

    console.error(
      "Unhandled error:",
      error
    );


    if (
      res.headersSent
    ) {

      return next(error);
    }


    res.status(500).json({

      success: false,

      error:
        "Erreur interne du serveur."
    });
  }
);


// =====================================================
// DÉMARRAGE
// =====================================================

async function startServer() {

  try {

    if (!pool) {

      throw new Error(
        "DATABASE_URL manque."
      );
    }


    await initializeDatabase();


    /*
      Vérification des abonnements expirés
      au démarrage.
    */

    await refreshExpiredSubscriptions();


    /*
      Vérification périodique.

      Toutes les 10 minutes.
    */

    setInterval(
      refreshExpiredSubscriptions,
      10 * 60 * 1000
    );


    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          "======================================"
        );

        console.log(
          "Lumio Backend 5.0.0"
        );

        console.log(
          `Running on port ${PORT}`
        );

        console.log(
          "Database: PostgreSQL"
        );

        console.log(
          "Authentication: JWT"
        );

        console.log(
          "Tasks: ON"
        );

        console.log(
          "Planning: ON"
        );

        console.log(
          "Notes: ON"
        );

        console.log(
          "Budget: ON"
        );

        console.log(
          "Goals: ON"
        );

        console.log(
          "Focus: ON"
        );

        console.log(
          "Premium: ON"
        );

        console.log(
          "Payments: ON"
        );

        console.log(
          "======================================"
        );
      }
    );


  } catch (error) {

    console.error(
      "Startup error:",
      error
    );

    process.exit(1);
  }
}


startServer();

          
