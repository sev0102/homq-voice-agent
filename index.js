import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test-Route für die Startseite
app.get("/", (req, res) => {
  res.send("HOMIQ Voice Agent Server läuft ✨");
});

// GET /twilio – damit du im Browser testen kannst
app.get("/twilio", (req, res) => {
  res.send("Twilio Webhook Endpoint ist erreichbar ✔️");
});

// Einstieg: Anruf kommt rein → Klaudi begrüßt und wartet auf Sprache
app.post("/twilio", (req, res) => {
  console.log("📞 Eingehender Anruf bei HOMQ – Klaudi wird aktiviert");

  const twiml = `
    <Response>
      <Say voice="Polly.Vicki" language="de-DE">
        Willkommen bei HOMQ. Du sprichst mit Klaudi, deiner digitalen Assistentin.
        Bitte beschreibe in einem Satz, wobei ich dir helfen kann.
      </Say>
      <Gather input="speech" action="/twilio/process" method="POST" language="de-DE" speechTimeout="auto">
        <Say voice="Polly.Vicki" language="de-DE">
          Ich höre zu.
        </Say>
      </Gather>
      <Say voice="Polly.Vicki" language="de-DE">
        Ich habe leider nichts verstanden. Bitte ruf gerne nochmal an.
      </Say>
      <Hangup/>
    </Response>
  `;

  res.type("text/xml");
  res.send(twiml);
});

// Verarbeitung: Twilio hat Sprache in Text umgewandelt → GPT antwortet
app.post("/twilio/process", async (req, res) => {
  try {
    const userText = req.body.SpeechResult || "";
    console.log("🗣️ Anrufer sagte:", userText);

    if (!userText) {
      const fallback = `
        <Response>
          <Say voice="Polly.Vicki" language="de-DE">
            Entschuldigung, ich habe nichts verstanden. Bitte versuch es noch einmal.
          </Say>
          <Redirect method="POST">/twilio</Redirect>
        </Response>
      `;
      res.type("text/xml");
      return res.send(fallback);
    }

    // OpenAI: Klaudi generiert eine Antwort
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Du bist Klaudi, die freundliche digitale Assistentin von HOMQ, einer modernen Hausverwaltungs-Plattform.
Sprich langsam, klar und in kurzen Sätzen. Du hilfst Mietern, Eigentümern und Verwaltern bei Fragen
zu Reparaturen, Schäden, Zahlungen, Dokumenten, Mietverträgen und Terminen.
Formuliere deine Antworten so, dass sie in der Telefonleitung gut verständlich sind.
          `.trim(),
        },
        {
          role: "user",
          content: userText,
        },
      ],
      max_tokens: 180,
    });

    const aiAnswer =
      completion.choices?.[0]?.message?.content?.trim() ||
      "Entschuldigung, ich konnte deine Anfrage nicht verarbeiten.";

    console.log("🤖 Klaudi antwortet:", aiAnswer);

    // Antwort an Twilio zurückgeben – wird am Telefon vorgelesen
    const twiml = `
      <Response>
        <Say voice="Polly.Vicki" language="de-DE">
          ${aiAnswer}
        </Say>
        <Say voice="Polly.Vicki" language="de-DE">
          Möchtest du noch etwas fragen? Bitte antworte nach dem Signalton.
        </Say>
        <Gather input="speech" action="/twilio/process" method="POST" language="de-DE" speechTimeout="auto">
          <Say voice="Polly.Vicki" language="de-DE">
            Ich höre zu.
          </Say>
        </Gather>
      </Response>
    `;

    res.type("text/xml");
    res.send(twiml);
  } catch (err) {
    console.error("❌ Fehler in /twilio/process:", err);

    const errorTwiml = `
      <Response>
        <Say voice="Polly.Vicki" language="de-DE">
          Entschuldigung, es ist ein technischer Fehler aufgetreten.
          Bitte versuche es später noch einmal.
        </Say>
        <Hangup/>
      </Response>
    `;
    res.type("text/xml");
    res.send(errorTwiml);
  }
});


// Port von Render oder lokal 3000
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🚀 Server gestartet auf Port " + PORT);
});
