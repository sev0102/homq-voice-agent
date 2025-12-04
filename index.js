//-------------------------------------------------------------
// HOMQ – KLAUDI 6.0 CLEAN VERSION
// - OpenAI TTS (tts-1, voice "nova")
// - Audio-Hosting direkt auf Render (/audio/:id.mp3)
// - Base44: callerLookup, callerUpdate, klaudiChat
// - Twilio: /twilio (Einstieg) + /process (Antworten)
//-------------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";
import crypto from "crypto";

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
const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL || `https://homiq-voice-agent.onrender.com`;

// In-Memory Store für generierte Audiofiles
const audioStore = new Map();

// ------------------------------------------------------------
// OPENAI CLIENT
// ------------------------------------------------------------
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ------------------------------------------------------------
// BASE44 FUNCTION CALL WRAPPER
// ------------------------------------------------------------
async function base44Function(fnName, payload = {}) {
    try {
        const res = await fetch(`${BASE44_URL}/api/functions/${fnName}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${BASE44_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            console.error(`❌ Base44 '${fnName}' Error:`, await res.text());
            return null;
        }

        return res.json();
    } catch (err) {
        console.error(`❌ Base44 '${fnName}' FAILED:`, err);
        return null;
    }
}

// ------------------------------------------------------------
// CALLER SYSTEM: callerLookup → callerUpdate
// ------------------------------------------------------------
async function getOrCreateCaller(phone) {
    const result = await base44Function("callerLookup", { phone });

    if (!result || !result.caller) {
        console.error("❌ callerLookup returned null");
        return null;
    }

    console.log("📞 Caller geladen:", result.caller.phone);
    return result.caller;
}

// ------------------------------------------------------------
// KLAUDI CHAT – Logik aus Base44
// ------------------------------------------------------------
async function askKlaudi(caller, transcript) {
    try {
        const payload = {
            caller: caller || null,
            message: transcript,
        };

        const result = await base44Function("klaudiChat", payload);

        if (!result) {
            console.error("❌ klaudiChat: kein Ergebnis");
            return "Entschuldigung, ich konnte gerade nichts Sinnvolles antworten.";
        }

        // Falls deine Base44-Funktion anders zurückgibt, hier anpassen:
        return result.reply || result.text || String(result);
    } catch (err) {
        console.error("❌ askKlaudi Fehler:", err);
        return "Entschuldigung, da ist gerade ein Fehler passiert.";
    }
}

// ------------------------------------------------------------
// TTS – Nova Stimme → MP3 → eigene URL für Twilio
// ------------------------------------------------------------
async function speakToUrl(text) {
    try {
        console.log("🗣️ TTS Input:", text);

        const audio = await openai.audio.speech.create({
            model: "tts-1",
            voice: "nova",
            speed: 0.93,
            input: text,
            // format: "mp3"  // mp3 ist Default; kann man explizit setzen
        });

        const buffer = Buffer.from(await audio.arrayBuffer());
        console.log("🔊 Generated Audio bytes:", buffer.length);

        const id = crypto.randomUUID();
        audioStore.set(id, buffer);

        const url = `${PUBLIC_BASE_URL}/audio/${id}.mp3`;
        console.log("✅ Local Audio URL für Twilio:", url);

        return url;
    } catch (err) {
        console.error("❌ TTS speakToUrl error:", err);
        return null;
    }
}

// ------------------------------------------------------------
// STATIC AUDIO ROUTE FÜR TWILIO
// Twilio ruft diese URL per GET auf, wir streamen MP3.
// ------------------------------------------------------------
app.get("/audio/:id.mp3", (req, res) => {
    const { id } = req.params;
    const buffer = audioStore.get(id);

    if (!buffer) {
        console.error("❌ Audio nicht gefunden:", id);
        return res.status(404).send("Audio not found");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
});

// ------------------------------------------------------------
// HEALTHCHECK
// ------------------------------------------------------------
app.get("/", (_req, res) => {
    res.send("KLAUDI Voice Agent is running.");
});

// ------------------------------------------------------------
// ERSTER ANRUF – BEGRÜßUNG
// Twilio Phone Number → Voice Webhook (HTTP POST) → /twilio
// ------------------------------------------------------------
app.post("/twilio", async (req, res) => {
    const phone = req.body.From;
    console.log("📲 Eingehender Anruf von:", phone);

    const caller = await getOrCreateCaller(phone);

    let greeting =
        "Hallo, ich bin Klaudi von HOMQ. Wie kann ich dir helfen?";

    if (caller?.name) {
        greeting = `Hallo ${caller.name}, wie kann ich dir helfen?`;
    } else {
        greeting = "Hallo, ich bin Klaudi von HOMQ. Wie darf ich dich nennen?";
    }

    const playUrl = await speakToUrl(greeting);

    if (!playUrl) {
        console.error("❌ Konnte Begrüßung nicht generieren – Fallback <Say>");
        const fallbackXml = `
      <Response>
        <Say voice="alice">Hallo, ich bin Klaudi von HOMQ.</Say>
        <Record 
          action="/process"
          playBeep="false"
          maxLength="10"
          trim="trim-silence"
        />
      </Response>`;

        console.log("➡️ Sending TwiML (fallback /twilio):", fallbackXml);
        return res.type("text/xml").send(fallbackXml);
    }

    const xml = `
    <Response>
      <Play>${playUrl}</Play>
      <Record 
        action="/process"
        playBeep="false"
        maxLength="10"
        trim="trim-silence"
      />
    </Response>`;

    console.log("➡️ Sending TwiML (/twilio):", xml);
    res.type("text/xml").send(xml);
});

// ------------------------------------------------------------
// SPRACHAUFSAGE VERARBEITEN
// Twilio sendet RecordingUrl, wir transkribieren mit OpenAI,
// sprechen Antwort + spielen sie wieder ab.
// ------------------------------------------------------------
app.post("/process", async (req, res) => {
    try, {
        const phone = req.body.From;
        const recordingUrl = req.body.RecordingUrl; // ohne .wav anhängen

        console.log("🎧 RecordingUrl von Twilio:", recordingUrl);

        // Direktes Transkribieren via file_url (kein Download nötig)
        const transcript = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file_url: `${recordingUrl}.wav`,
            response_format: "text",
        });

        console.log("📝 Transcript:", transcript);

        const caller = await getOrCreateCaller(phone);

        // Name speichern, falls noch leer & kurzer Text
        if (caller && !caller.name && transcript.length < 25) {
            await base44Function("callerUpdate", {
                id: caller.id,
                name: transcript.trim(),
            });
        }

        const reply = await askKlaudi(caller, transcript);
        const playUrl = await speakToUrl(reply);

        if (!playUrl) {
            console.error("❌ Konnte Antwort nicht generieren – Fallback <Say>");
            const fallbackXml = `
        <Response>
          <Say voice="alice">
            Entschuldigung, ich konnte keine Antwort generieren.
          </Say>s
          <Redirect>/twilio</Redirect>
        </Response>`;

            console.log("➡️ Sending TwiML (fallback /process):", fallbackXml);
            return res.type("text/xml").send(fallbackXml);
        }

        const xml = `
      <Response>
        <Play>${playUrl}</Play>
        <Redirect>/twilio</Redirect>
      </Response>`;

        console.log("➡️ Sending TwiML (/process):", xml);
        res.type("text/xml").send(xml);
    } catch (err) {
        console.error("❌ Prozessfehler /process:", err);

        const xml = `
      <Response>
        <Say voice="alice">
          Entschuldigung, da ging etwas schief.
        </Say>
        <Redirect>/twilio</Redirect>
      </Response>`;

        res.type("text/xml").send(xml);
    }
});

// ------------------------------------------------------------
// SERVER STARTEN
// ------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 KLAUDI Voice Agent läuft auf Port ${PORT}`);
});
