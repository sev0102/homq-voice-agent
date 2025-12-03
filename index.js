import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

// Twilio schickt Daten als x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// OpenAI-Client (Klaudis „Gehirn“)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Kleine Hilfe-Funktion, damit der Text sicher in XML passt
function escapeXml(unsafe = "") {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// --- Test-Route für die Startseite ---
app.get("/", (req, res) => {
  res.send("HOMQ Voice Agent Server läuft ✨");
});

// --- GET /twilio – zum Testen im Browser ---
app.get("/twilio", (req, res) => {
  res.send("Twilio Webhook Endpoint ist erreichbar ✅");
});

// --- POST /twilio – wird von Twilio bei eingehendem Anruf aufgerufen ---
app.post("/twilio", (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Marlene" language="de-DE">
    Hallo, hier ist Klaudi, deine digitale Assistentin von HOMQ.
    Ich helfe dir bei Fragen zu Mietern, Objekten, Schäden und Tickets.
  </Say>

  <Gather input="speech"
          language="de-DE"
          action="/twilio/answer"
          method="POST"
          timeout="6">
    <Say voice="Polly.Marlene" language="de-DE">
      Bitte beschreibe kurz dein Anliegen nach dem Signalton.
    </Say>
  </Gather>

  <Say voice="Polly.Marlene" language="de-DE">
    Ich habe leider nichts gehört. Bitte versuche es später noch einmal.
  </Say>
  <Hangup/>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

// --- POST /twilio/answer – hier kommt die KI-Antwort von Klaudi ---
app.post("/twilio/answer", async (req, res) => {
  const userText = (req.body.SpeechResult || "").trim();
  console.log("🔊 Anrufer sagte:", userText);

  if (!userText) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Marlene" language="de-DE">
    Ich habe dich leider nicht verstanden. Kannst du dein Anliegen bitte noch einmal wiederholen?
  </Say>
  <Redirect method="POST">/twilio</Redirect>
</Response>`;
    res.type("text/xml");
    return res.send(twiml);
  }

  const systemPrompt = `
Du heißt Klaudi und bist eine freundliche, ruhige Telefon-Assistentin
für die Hausverwaltungs-Software HOMQ.

Aufgaben:
- Anliegen rund um Immobilien, Einheiten, Mieter und Tickets aufnehmen.
- Wichtige Infos strukturiert erfragen (Name, Adresse/Objekt, Rückrufnummer, Dringlichkeit).
- Bei Notfällen (Wasser, Heizungsausfall, Strom, Brandgefahr) klar und ruhig reagieren
  und den Fall als "Notfall" markieren.
- Am Ende kurz zusammenfassen, was du notiert hast.

Regeln:
- Sprich IMMER auf Deutsch.
- Benutze kurze, klare Sätze.
- Sei freundlich, ruhig und professionell.
- Stell maximal eine Frage pro Satz.
`;

  let aiText =
    "Es tut mir leid, es ist ein technischer Fehler aufgetreten. Bitte versuche es später noch einmal.";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    });

    aiText = completion.choices[0].message.content;
    console.log("🤖 Klaudi antwortet:", aiText);
  } catch (err) {
    console.error("OpenAI-Fehler:", err);
  }

  const safeText = escapeXml(aiText);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Marlene" language="de-DE">
    ${safeText}
  </Say>

  <Gather input="speech"
          language="de-DE"
          action="/twilio/answer"
          method="POST"
          timeout="6">
    <Say voice="Polly.Marlene" language="de-DE">
      Gibt es noch etwas, wobei ich dir helfen kann?
    </Say>
  </Gather>

  <Say voice="Polly.Marlene" language="de-DE">
    Vielen Dank für deinen Anruf bei HOMQ. Auf Wiederhören!
  </Say>
  <Hangup/>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

// --- Port für Render oder lokal ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 Server gestartet auf Port " + PORT);
});
