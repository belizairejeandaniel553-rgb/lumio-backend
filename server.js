require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

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

    version: "2.0.0",

    features: [

      "authentication",

      "postgresql",

      "premium",

      "subscription-status",

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

      database = "offline";

    }

  }

  res.json({

    success: true,

    backend: "online",

    database,

    service: "Lumio Backend",

    version: "2.0.0"

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
// GET PREMIUM STATUS
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

    /*
      IMPORTANT

      Cette route est préparée pour le
      véritable fournisseur de paiement.

      On NE valide PAS Premium ici.

      Premium doit uniquement être activé
      après confirmation du paiement par
      le webhook du fournisseur.
    */


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


      /*
        PLUS TARD :

        Ici nous créerons la session
        de paiement avec le fournisseur
        compatible avec Lumio.

        Exemple :

        const checkoutUrl = ...

        Pour l'instant nous ne
        prétendons pas avoir effectué
        un paiement.
      */


      res.status(501).json({

        success: false,

        paymentReady: false,

        error:
          "Le fournisseur de paiement doit encore être configuré."

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
// DEVELOPMENT PREMIUM ACTIVATION
// =====================================================

app.post(
  "/api/subscription/demo-activate",
  authenticate,
  async (req, res) => {

    /*
      ROUTE DE TEST UNIQUEMENT.

      NE PAS UTILISER COMME SYSTÈME
      DE PAIEMENT PRODUCTION.
    */


    if (
      process.env.NODE_ENV === "production"
    ) {

      return res.status(403).json({

        success: false,

        error:
          "Activation de démonstration désactivée en production."

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

    /*
      Le fournisseur de paiement
      appellera cette route.

      IMPORTANT :

      Avant la mise en production,
      il faudra vérifier la signature
      du webhook fournie par le
      prestataire.
    */


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
