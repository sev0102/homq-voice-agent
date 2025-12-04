//-------------------------------------------------------------
// HOMIQ Voice Agent – Option A (Best Architecture)
// - Twilio Webhooks
// - Base44 (Caller-System + klaudiChat)
// - OpenAI TTS (Nova)
// - Local MP3 hosting for Twilio (no Rauschen)
//-------------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";
import { Caller, klaudiChat } from "./base44/functions.js"; // <– prüfe Pfad
dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

// ------------------------------------------------------------
// OPENAI CLIENT
// ------------------------------------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------------------------------------------------------------
// IN-MEMORY AUDIO STORE
// ------------------------------------------------------------
const audioStore = new Map();

app.get("/audio/:id.mp3", (req, res) => {
    const audio = audioStore.get(req.params.id);
    if (!audio) return res.status(404).send("Audio not found");

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audio);
});

// ------------------------------------------------------------
// HELPER → generate MP3 URL via OpenAI TTS
// ------------------------------------------------------------
async function speak(text) {
    const result = await openai.audio.speech.create({
        model: "tts-1",
        voice: "nova",
        speed: 0.93,
        input: text
    });

    const buffer = Buffer.from(await result.arrayBuffer());
    const id = crypto.randomUUID();
    audioStore.set(id, buffer);

    return `${PUBLIC_BASE_URL}/audio/${id}.mp3`;
}

// ------------------------------------------------------------
// BASE44 → callerLookup + callerUpdate + klaudiChat
// ------------------------------------------------------------
async function loadCaller(phone) {
    try {
        const callers = await Caller.filter({ phone });
        if (callers.length === 0) return null;
        return callers[0];
    } catch (e) {
        console.error("Caller lookup failed:", e);
        return null;
    }
}

async function updateCallerName(id, name) {
    try {
        await Caller.update(id, { name });
    } catch (e) {
        console.error("updateCallerName failed:", e);
    }
}

// ------------------------------------------------------------
// TWILIO: incoming call
// ------------------------------------------------------------
app.post("/twilio", async (req, res) => {
    const phone = req.body.From;

    const caller = await loadCaller(phone);

    let greeting = caller?.name
        ? `Hallo ${caller.name}, wie kann ich dir helfen?`
        : "Hallo, ich bin Klaudi von HOMIQ. Wie darf ich dich nennen?";

    const greetingUrl = await speak(greeting);

    const twiml = `
    <Response>
      <Play>${greetingUrl}</Play>
      <Record 
        action="/process"
        playBeep="false"
        maxLength="10"
        trim="trim-silence"
      />
    </Response>
  `;

    res.type("text/xml").send(twiml);
});

// ------------------------------------------------------------
// TWILIO: processing recording
// ------------------------------------------------------------
app.post("/process", async (req, res) => {
    try {
        const phone = req.body.From;
        const recordingUrl = req.body.RecordingUrl;

        const transcript = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file_url: `${recordingUrl}.wav`,
            response_format: "text"
        });

        const caller = await loadCaller(phone);

        // Caller Name speichern
        if (caller && !caller.name && transcript.length < 25) {
            await updateCallerName(caller.id, transcript.trim());
        }

        const chatResponse = await klaudiChat.invoke({
            caller: caller || null,
            message: transcript
        });

        const reply =
            chatResponse?.reply ||
            chatResponse?.message ||
            "Entschuldigung, ich habe dich nicht verstanden.";

        const replyUrl = await speak(reply);

        const twiml = `
      <Response>
        <Play>${replyUrl}</Play>
        <Redirect>/twilio</Redirect>
      </Response>
    `;

        res.type("text/xml").send(twiml);
    } catch (e) {
        console.error("process error:", e);
        return res.type("text/xml").send(`
      <Response>
        <Say>Fehler bei der Verarbeitung.</Say>
        <Redirect>/twilio</Redirect>
      </Response>
    `);
    }
});

// ------------------------------------------------------------
// HEALTHCHECK
// ------------------------------------------------------------
app.get("/", (req, res) => res.send("Klaudi Voice Agent läuft."));

// ------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 Voice Agent läuft auf Port ${PORT}`);
});
