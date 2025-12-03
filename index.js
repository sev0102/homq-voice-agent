import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Basic test route
app.get("/", (req, res) => {
  res.send("HOMIQ Voice Agent Server laeuft ✨");
});

// Twilio Voice Webhook (wird später mit OpenAI verbunden)
app.post("/twilio", (req, res) => {
  console.log("📞 Eingehender Anruf erhalten!");

  const twiml = `
        <Response>
            <Say voice="Polly.Vicki" language="de-DE">
                Willkommen bei HOMIQ. Einen Moment bitte.
            </Say>
        </Response>
    `;

  res.type("text/xml");
  res.send(twiml);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server gestartet auf Port " + PORT);
});
