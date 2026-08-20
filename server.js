// =====================================================
// AUTHENTIFICATION — REGISTER / LOGIN / PROFILE
// =====================================================

const bcrypt = require("bcryptjs");


// =====================================================
// REGISTER
// =====================================================

app.post("/api/auth/register", async (req, res) => {

  if (!pool) {

    return res.status(503).json({
      success: false,
      error: "Base de données indisponible."
    });

  }

  try {

    const { email, password } = req.body;

    // Vérification des données
    if (!email || !password) {

      return res.status(400).json({
        success: false,
        error: "Email et mot de passe sont obligatoires."
      });

    }

    // Nettoyage de l'email
    const cleanEmail =
      String(email).trim().toLowerCase();

    // Vérification simple de l'email
    if (
      !cleanEmail.includes("@") ||
      !cleanEmail.includes(".")
    ) {

      return res.status(400).json({
        success: false,
        error: "Adresse email invalide."
      });

    }

    // Longueur minimale du mot de passe
    if (String(password).length < 8) {

      return res.status(400).json({
        success: false,
        error:
          "Le mot de passe doit contenir au moins 8 caractères."
      });

    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser =
      await pool.query(
        `
        SELECT id
        FROM users
        WHERE email = $1
        `,
        [cleanEmail]
      );

    if (existingUser.rows.length > 0) {

      return res.status(409).json({
        success: false,
        error: "Un compte avec cet email existe déjà."
      });

    }

    // Hash sécurisé du mot de passe
    const passwordHash =
      await bcrypt.hash(password, 12);

    // Création du compte
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

    // Création du JWT
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
        premium: user.premium,
        createdAt: user.created_at
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

});


// =====================================================
// LOGIN
// =====================================================

app.post("/api/auth/login", async (req, res) => {

  if (!pool) {

    return res.status(503).json({

      success: false,

      error:
        "Base de données indisponible."

    });

  }

  try {

    const { email, password } = req.body;

    // Vérification des données
    if (!email || !password) {

      return res.status(400).json({

        success: false,

        error:
          "Email et mot de passe sont obligatoires."

      });

    }

    // Nettoyage de l'email
    const cleanEmail =
      String(email)
        .trim()
        .toLowerCase();

    // Recherche utilisateur
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

    if (result.rows.length === 0) {

      return res.status(401).json({

        success: false,

        error:
          "Email ou mot de passe incorrect."

      });

    }

    const user =
      result.rows[0];

    // Vérification du mot de passe
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

    // Création du JWT
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

});


// =====================================================
// PROFIL UTILISATEUR
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

      if (result.rows.length === 0) {

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
