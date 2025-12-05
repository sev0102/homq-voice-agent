import express from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import cors from "cors";
import bodyParser from "body-parser";

// Load ENV
dotenv.config();

// Initialize express
const app = express();

// Middlewares
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));
app.use(morgan("dev"));

// --- ROUTES IMPORTS ---
import twilioRoutes from "./routes/twilio.routes.js";
import aiRoutes from "./routes/ai.routes.js";

// --- ROUTES REGISTER ---
app.use("/twilio", twilioRoutes);   // Twilio Webhooks
app.use("/ai", aiRoutes);           // Optional AI Endpoints for testing

// HEALTH CHECK
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "HOMIQ Voice Backend is running",
    uptime: process.uptime(),
  });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 HOMIQ Voice Backend running on port ${PORT}`);
});
