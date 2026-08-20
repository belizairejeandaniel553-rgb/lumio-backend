require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();

app.disable("x-powered-by");


// =====================================================
// CONFIGURATION
// =====================================================

const PORT =
  Number(process.env.PORT) || 10000;

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "CHANGE_ME_IN_RENDER";

if (
  process.env.NODE_ENV === "production" &&
  !process.env.JWT_SECRET
) {
  console.error(
    "ERREUR: JWT_SECRET manque dans les variables Render."
  );

  process.exit(1);
}


// =====================================================
// CORS
// =====================================================

app.use(
  cors({
    origin: true,
    credentials: true
  })
);


// =====================================================
// JSON
// =====================================================

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
        ? { rejectUnauthorized: false }
        : false
  });

  pool.on("error", (err) => {

    console.error(
      "PostgreSQL error:",
      err
    );

  });

} else {

  console.warn(
    "DATABASE_URL n'est pas configurée."
  );

}


// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {

  res.json({

    app: "Lumio",

    backend: "online",

    version: "2.1.0",

    features: [
      "authentication",
      "postgresql",
      "premium",
      "subscription-status",
      "tasks",
      "planning",
      "notes",
      "budget",
      "goals",
      "focus",
      "pwa-ready"
    ]

  });

});


// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/api/health", async (req, res) => {

  let database = "not_configured";

  if (pool) {

    try {

      await pool.query("SELECT 1");

      database = "online";

    } catch (error) {

      console.error(
        "Database health error:",
        error
      );

      database = "offline";

    }

  }

  res.json({

    success: true,

    backend: "online",

    database,

    service: "Lumio Backend",

    version: "2.1.0"

  });

});


// =====================================================
// DATABASE INITIALIZATION
// =====================================================

async function initializeDatabase() {

  if (!pool) {

    console.log(
      "Database initialization skipped."
    );

    return;

  }


  // USERS
  await pool.query(`

    CREATE TABLE IF NOT EXISTS users (

      id SERIAL PRIMARY KEY,

      email VARCHAR(255)
        UNIQUE NOT NULL,

      password_hash TEXT NOT NULL,

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
        NOT NULL DEFAULT 'premium_monthly',

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


  // EVENTS / PLANNING
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

      content TEXT,

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

      amount NUMERIC(12,2) NOT NULL,

      type VARCHAR(20) NOT NULL,

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
// AUTHENTICATION MIDDLEWARE
// =====================================================

function authenticate(req, res, next) {

  const header =
    req.headers.authorization || "";

  if (
    !header.startsWith("Bearer ")
  ) {

    return res.status(401).json({

      success: false,

      error:
        "Token d'authentification manquant."

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

  } catch (error) {

    return res.status(401).json({

      success: false,

      error:
        "Token invalide ou expiré."

    });

  }

}


// =====================================================
// REGISTER
// =====================================================

app.post(
  "/api/auth/register",
  async (req, res) => {

    if (!pool) {

      return res.status(503).json({

        success: false,

        error:
          "Base de données indisponible."

      });

    }


    try {

      const {
        email,
        password
      } = req.body;


      if (!email || !password) {

        return res.status(400).json({

          success: false,

          error:
            "Email et mot de passe sont obligatoires."

        });

      }


      const cleanEmail =
        String(email)
          .trim()
          .toLowerCase();


      if (
        !cleanEmail.includes("@") ||
        !cleanEmail.includes(".")
      ) {

        return res.status(400).json({

          success: false,

          error:
            "Adresse email invalide."

        });

      }


      if (
        String(password).length < 8
      ) {

        return res.status(400).json({

          success: false,

          error:
            "Le mot de passe doit contenir au moins 8 caractères."

        });

      }


      const existingUser =
        await pool.query(

          `
          SELECT id
          FROM users
          WHERE email = $1
          LIMIT 1
          `,

          [cleanEmail]

        );


      if (
        existingUser.rows.length > 0
      ) {

        return res.status(409).json({

          success: false,

          error:
            "Un compte avec cet email existe déjà."

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
          INSERT INTO users (
            email,
            password_hash,
            premium
          )

          VALUES (
            $1,
            $2,
            FALSE
          )

          RETURNING
            id,
            email,
            premium,
            created_at
          `,

          [
            cleanEmail,
            passwordHash
          ]

        );


      const user =
        result.rows[0];


      const token =
        jwt.sign(

          {
            id: user.id,
            email: user.email
          },

          JWT_SECRET,

          {
            expiresIn: "7d"
          }

        );


      return res.status(201).json({

        success: true,

        message:
          "Compte Lumio créé avec succès.",

        token,

        user: {

          id: user.id,

          email: user.email,

          premium:
            user.premium === true,

          createdAt:
            user.created_at

        }

      });

    } catch (error) {

      console.error(
        "REGISTER ERROR:",
        error
      );

      return res.status(500).json({

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

    if (!pool) {

      return res.status(503).json({

        success: false,

        error:
          "Base de données indisponible."

      });

    }


    try {

      const {
        email,
        password
      } = req.body;


      if (!email || !password) {

        return res.status(400).json({

          success: false,

          error:
            "Email et mot de passe sont obligatoires."

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
            premium,
            created_at

          FROM users

          WHERE email = $1

          LIMIT 1
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


      const passwordCorrect =
        await bcrypt.compare(

          password,

          user.password_hash

        );


      if (!passwordCorrect) {

        return res.status(401).json({

          success: false,

          error:
            "Email ou mot de passe incorrect."

        });

      }


      const token =
        jwt.sign(

          {
            id: user.id,
            email: user.email
          },

          JWT_SECRET,

          {
            expiresIn: "7d"
          }

        );


      return res.json({

        success: true,

        message:
          "Connexion réussie.",

        token,

        user: {

          id: user.id,

          email: user.email,

          premium:
            user.premium === true,

          createdAt:
            user.created_at

        }

      });

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({

        success: false,

        error:
          "Impossible de se connecter."

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

    if (!pool) {

      return res.status(503).json({

        success: false,

        error:
          "Base de données indisponible."

      });

    }


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

          LIMIT 1
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


      const user =
        result.rows[0];


      return res.json({

        success: true,

        user: {

          id: user.id,

          email: user.email,

          premium:
            user.premium === true,

          createdAt:
            user.created_at

        }

      });

    } catch (error) {

      console.error(
        "PROFILE ERROR:",
        error
      );

      return res.status(500).json({

        success: false,

        error:
          "Impossible de récupérer le profil."

      });

    }

  }
);


// =====================================================
// PREMIUM STATUS
// =====================================================

app.get(
  "/api/subscription/status",
  authenticate,
  async (req, res) => {

    if (!pool) {

      return res.status(503).json({

        success: false,

        error:
          "Base de données indisponible."

      });

    }


    try {

      const result =
        await pool.query(

          `
          SELECT

            u.id,

            u.email,

            u.premium,

            s.status,

            s.plan,

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


      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          error:
            "Utilisateur introuvable."

        });

      }


      const user =
        result.rows[0];


      res.json({

        success: true,

        premium:
          user.premium === true,

        subscription: {

          status:
            user.status ||
            "inactive",

          plan:
            user.plan ||
            null,

          expiresAt:
            user.expires_at ||
            null

        }

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({

        success: false,

        error:
          "Erreur serveur."

      });

    }

  }
);


// =====================================================
// CREATE PREMIUM CHECKOUT
// =====================================================

app.post(
  "/api/subscription/create",
  authenticate,
  async (req, res) => {

    if (!pool) {

      return res.status(503).json({

        success: false,

        error:
          "Base de données indisponible."

      });

    }


    try {

      const userResult =
        await pool.query(

          `
          SELECT id, email
          FROM users
          WHERE id = $1
          `,

          [req.user.id]

        );


      if (
        userResult.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          error:
            "Utilisateur introuvable."

        });

      }


      return res.status(501).json({

        success: false,

        paymentReady: false,

        error:
          "Le fournisseur de paiement doit encore être configuré."

      });

    } catch (error) {

      console.error(error);

      return res.status(500).json({

        success: false,

        error:
          "Erreur serveur."

      });

    }

  }
);


// =====================================================
// DEMO PREMIUM
// =====================================================

app.post(
  "/api/subscription/demo-activate",
  authenticate,
  async (req, res) => {

    if (
      process.env.NODE_ENV === "production"
    ) {

      return res.status(403).json({

        success: false,

        error:
          "Activation de démonstration désactivée en production."

      });

    }


    if (!pool) {

      return res.status(503).json({

        success: false,

        error:
          "Base de données indisponible."

      });

    }


    try {

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
        INSERT INTO subscriptions (

          user_id,
          status,
          plan,
          provider,
          started_at

        )

        VALUES (

          $1,
          'active',
          'premium_monthly',
          'demo',
          CURRENT_TIMESTAMP

        )
        `,

        [req.user.id]

      );


      res.json({

        success: true,

        premium: true,

        message:
          "Premium activé en mode démonstration."

      });

    } catch (error) {

      console.error(error);

      res.status(500).json({

        success: false,

        error:
          "Impossible d'activer Premium."

      });

    }

  }
);


// =====================================================
// PAYMENT WEBHOOK
// =====================================================

app.post(
  "/api/subscription/webhook",
  async (req, res) => {

    console.log(
      "Webhook reçu."
    );


    res.json({

      received: true

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
          `Lumio Backend running on port ${PORT}`
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
