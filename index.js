import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Test-Route für die Startseite
app.get("/", (req, res) => {
  res.send("HOMIQ Voice Agent Server läuft ✨");
});

// GET /twilio – damit du im Browser testen kannst
app.get("/twilio", (req, res) => {
  res.send("Twilio Webhook Endpoint ist erreichbar ✔️");
});

// POST /twilio – hier kommt Twilio später rein
app.post("/twilio", (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Vicki" language="de-DE">
    Willkommen bei HOMIQ. Einen Moment bitte.
  </Say>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

// Port von Render oder lokal 3000
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server gestartet auf Port " + PORT);
});
