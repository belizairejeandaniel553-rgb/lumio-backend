require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.disable("x-powered-by");

app.use(cors());

app.use(express.json({
  limit: "1mb"
}));

// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {
  res.json({
    app: "Lumio",
    backend: "online",
    version: "1.0.0"
  });
});

// ===============================
// HEALTH CHECK
// ===============================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    backend: "online",
    service: "Lumio Backend",
    version: "1.0.0"
  });
});

// ===============================
// PORT
// ===============================

const PORT = Number(process.env.PORT) || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lumio Backend running on port ${PORT}`);
});
