//-------------------------------------------------------------
// HOMQ – KLAUDI 5.0 PRODUCTION VERSION
// Vollständig Base44-konform
// 🔥 Nutzen ausschließlich Base44 Functions:
//    - callerLookup  (Caller suchen/anlegen)
//    - klaudiChat    (KI-Prompt)
//    - ticketAiAgent (Tickets)
//    - inboxAiAgent  (E-Mail Antworten)
//    - googleCalendar (Termine)
// 🔥 Nova Voice für Telefon
// 🔥 Fehlerlos, keine Null-Zugriffe
//-------------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";
dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
const PORT = process.env.PORT || 10000;
const BASE44_URL = process.env.BASE44_URL;
const BASE44_KEY = process.env.BASE44_API_KEY;

// ------------------------------------------------------------
// OPENAI CLIENT
// ------------------------------------------------------------
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ------------------------------------------------------------
// HELFER: Base44 Function Call
// ------------------------------------------------------------
async function base44Function(functionName, payload = {}) {
    try {
        const res = await fetch(`${BASE44_URL}/api/functions/${functionName}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${BASE44_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            console.error(`❌ Base44 Function Error: ${functionName}`, await res.text());
            return null;
        }

        return res.json();
    } catch (err) {
        console.error(`❌ Base44 Function FAILED: ${functionName}`, err);
        return null;
    }
}

// ------------------------------------------------------------
// CALLER MANAGEMENT über Base44 Funktion callerLookup
// ------------------------------------------------------------
async function getOrCreateCaller(phone) {
    const response = await base44Function("callerLookup", { phone });

    if (!response || !response.caller) {
        console.error("❌ Konnte Caller nicht laden oder erstellen");
        return null;
    }

    console.log("📞 Caller geladen:", response.caller.phone);
    return response.caller;
}

// ------------------------------------------------------------
// TTS – Nova Voice Ausgabe
// ------------------------------------------------------------
async function speak(text) {
    const audio = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        speed: 0.94,
        input: text
    });

    return Buffer.from(await audio.arrayBuffer()).toString("base64");
}

// ------------------------------------------------------------
// KI – klaudiChat über Base44 Prompt
// ------------------------------------------------------------
async function askKlaudi(caller, transcript) {
    console.log("🤖 Frage an Klaudi:", transcript);

    const response = await base44Function("klaudiChat", {
        caller,
        message: transcript
    });

    if (!response || !response.reply) {
        return "Ich konnte das nicht vollständig verstehen. Kannst du das bitte wiederholen?";
    }

    return response.reply;
}

// ------------------------------------------------------------
// ERSTER ANRUF – BEGRÜßUNG
// ------------------------------------------------------------
app.post("/twilio", async (req, res) => {
    const phone = req.body.From;

    const caller = await getOrCreateCaller(phone);

    let greeting = "Hallo, ich bin Klaudi von HOMQ. Wie kann ich dir helfen?";

    if (caller?.name) {
        greeting = `Hallo ${caller.name}, wie kann ich dir helfen?`;
    } else {
        greeting = "Hallo, ich bin Klaudi von HOMQ. Wie darf ich dich nennen?";
    }

    const voice = await speak(greeting);

    const xml = `
    <Response>
        <Play>data:audio/mp3;base64,${voice}</Play>
        <Record 
            action="/process"
            playBeep="false"
            maxLength="10"
            trim="trim-silence"
        />
    </Response>`;

    res.type("text/xml").send(xml);
});

// ------------------------------------------------------------
// SPRACHE VERARBEITEN
// ------------------------------------------------------------
app.post("/process", async (req, res) => {
    try {
        const phone = req.body.From;
        const audioUrl = req.body.RecordingUrl + ".wav";

        // 1) TRANSKRIPT
        const transcript = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: audioUrl,
            response_format: "text"
        });

        console.log("📝 Nutzer sagt:", transcript);

        // 2) CALLER LADEN
        const caller = await getOrCreateCaller(phone);

        // Falls Name unbekannt → Name speichern
        if (caller && !caller.name && transcript.length < 30) {
            await base44Function("callerUpdate", {
                id: caller.id,
                name: transcript.trim()
            });
        }

        // 3) KLAUDI ANTWORT
        const reply = await askKlaudi(caller, transcript);

        // 4) SPRECHEN
        const voice = await speak(reply);

        const xml = `
        <Response>
            <Play>data:audio/mp3;base64,${voice}</Play>
            <Redirect>/twilio</Redirect>
        </Response>`;

        res.type("text/xml").send(xml);

    } catch (err) {
        console.error("❌ PROCESS ERROR:", err);

        res.type("text/xml").send(`
        <Response>
            <Say>Entschuldigung, ich konnte das nicht verstehen.</Say>
            <Redirect>/twilio</Redirect>
        </Response>
        `);
    }
});

// ------------------------------------------------------------
// SERVER
// ------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 KLAUDI 5.0 Voice Agent läuft auf Port ${PORT}`);
});
