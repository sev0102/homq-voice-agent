//-------------------------------------------------------------
// HOMQ – KLAUDI 4.0 HIGH-END VOICE AGENT
// Vollständig Base44-konform
// - Caller statt User anlegen
// - sichere Fehlerbehandlung
// - Nova Voice
// - Inbox Antworten, Tickets, Termine
// - Keine Dokumentfunktionen
//-------------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";
dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
const BASE44_URL = process.env.BASE44_URL;
const BASE44_KEY = process.env.BASE44_API_KEY;

// ------------------------------------------------------------------
// OPENAI CLIENT
// ------------------------------------------------------------------
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ------------------------------------------------------------------
// GENERISCHE BASE44 FUNKTION
// ------------------------------------------------------------------
async function base44(path, method = "GET", body = null) {
    try {
        const res = await fetch(`${BASE44_URL}${path}`, {
            method,
            headers: {
                "Authorization": `Bearer ${BASE44_KEY}`,
                "Content-Type": "application/json"
            },
            body: body ? JSON.stringify(body) : null
        });

        if (!res.ok) {
            console.error("❌ Base44 ERROR:", await res.text());
            return null;
        }

        return res.json();
    } catch (err) {
        console.error("❌ Base44 Request FAILED:", err);
        return null;
    }
}

// ------------------------------------------------------------------
// CALLER-LOGIK — ANLEGEN & SUCHEN
// ------------------------------------------------------------------
async function getOrCreateCaller(phone) {
    if (!phone) return null;

    console.log("📞 Suche Caller:", phone);

    // 1) Suche Caller
    const filter = encodeURIComponent(JSON.stringify({ phone }));
    const existing = await base44(`/api/entities/Caller?where=${filter}`);

    if (existing?.items?.length > 0) {
        console.log("📞 Bekannter Caller gefunden:", existing.items[0]);
        return existing.items[0];
    }

    console.log("➕ Neuer Caller wird erstellt…");

    // 2) Caller anlegen
    const newCaller = await base44("/api/entities/Caller", "POST", {
        data: {
            phone,
            name: null,
            last_call: new Date().toISOString()
        }
    });

    console.log("✨ Neuer Caller:", newCaller);
    return newCaller;
}

// ------------------------------------------------------------------
// TEXT ZU SPRACHE (NOVA)
// ------------------------------------------------------------------
async function speak(text) {
    const audio = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        speed: 0.94,
        input: text
    });

    return Buffer.from(await audio.arrayBuffer()).toString("base64");
}

// ------------------------------------------------------------------
// KLAUDI PROMPT (über Base44)
// ------------------------------------------------------------------
async function askKlaudi(caller, transcript) {
    const payload = {
        caller,
        message: transcript
    };

    const result = await base44("/api/functions/klaudiChat", "POST", payload);

    if (!result || !result.reply) {
        return "Ich konnte deine Anfrage nicht vollständig verarbeiten, aber ich helfe dir trotzdem. Wie kann ich dir helfen?";
    }

    return result.reply;
}

// ------------------------------------------------------------------
// ERSTER ANRUF – BEGRÜßUNG
// ------------------------------------------------------------------
app.post("/twilio", async (req, res) => {
    const phone = req.body.From;

    const caller = await getOrCreateCaller(phone);

    let greeting = "Hallo, ich bin Klaudi von HOMQ. Wie kann ich dir helfen?";

    if (caller && caller.name) {
        greeting = `Hallo ${caller.name}, ich bin Klaudi von HOMQ. Wie kann ich dir helfen?`;
    } else if (caller) {
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

    res.set("Content-Type", "text/xml");
    return res.send(xml);
});

// ------------------------------------------------------------------
// SPRACHAUSWERTUNG
// ------------------------------------------------------------------
app.post("/process", async (req, res) => {
    try {
        const phone = req.body.From;
        const audioUrl = req.body.RecordingUrl + ".wav";

        console.log("🎧 Neue Aufnahme:", audioUrl);

        // (1) TRANSKRIPT
        const transcript = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: audioUrl,
            response_format: "text"
        });

        console.log("📝 Nutzer sagt:", transcript);

        // Caller laden
        const caller = await getOrCreateCaller(phone);

        // (2) KLAUDI ANTWORT
        const klaudiReply = await askKlaudi(caller, transcript);

        // (3) NOVA SPRICHT
        const voice = await speak(klaudiReply);

        const xml = `
        <Response>
            <Play>data:audio/mp3;base64,${voice}</Play>
            <Redirect>/twilio</Redirect>
        </Response>`;

        res.set("Content-Type", "text/xml");
        return res.send(xml);

    } catch (err) {
        console.error("❌ PROCESS ERROR:", err);

        return res.send(`
        <Response>
            <Say>Entschuldigung, das konnte ich nicht verstehen.</Say>
            <Redirect>/twilio</Redirect>
        </Response>`);
    }
});

// ------------------------------------------------------------------
// SERVER
// ------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 KLAUDI Voice Agent läuft auf Port ${PORT}`);
});
