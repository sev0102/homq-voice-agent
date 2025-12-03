//-------------------------------------------------------------
// HOMQ – KLAUDI 5.1 PRODUCTION VERSION
// - Richtige TTS Engine (tts-1)
// - Voll Base44-konform
// - callerLookup + callerUpdate
// - klaudiChat über Base44 Prompt
// - Audio-Fallbacks
// - Null-sicher, keine Abstürze
//-------------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
// BASE44 FUNCTION CALL WRAPPER
// ------------------------------------------------------------
async function base44Function(fnName, payload = {}) {
    try {
        const res = await fetch(`${BASE44_URL}/api/functions/${fnName}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${BASE44_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
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
// TTS – Nova Stimme mit richtigem Modell (tts-1) + Logging
// ------------------------------------------------------------
async function speak(text) {
    try {
        console.log("🗣️ TTS Input:", text);

        const audio = await openai.audio.speech.create({
            model: "tts-1",
            voice: "nova",
            speed: 0.93,
            input: text
        });

        const buffer = Buffer.from(await audio.arrayBuffer());
        const base64 = buffer.toString("base64");

        console.log("🔊 Generated Audio (start):", base64.substring(0, 50) + "...");
        console.log("🔊 Generated Audio length:", base64.length); // NEUE ZEILE: Länge des Base64-Strings loggen

        if (base64.length === 0) { // NEUE PRÜFUNG: Wenn Base64-String leer ist
            console.error("❌ Generated Base64 audio is empty, returning null.");
            return null;
        }

        return base64;
    } catch (err) {
        console.error("❌ TTS speak error:", err);
        return null;
    }
}

// ... keep existing code ...

// ------------------------------------------------------------
// ASK KLAUDI (prompt läuft über Base44)
// ------------------------------------------------------------
async function askKlaudi(caller, transcript) {
    console.log("🤖 Query to klaudiChat:", transcript);

    const result = await base44Function("klaudiChat", {
        caller,
        message: transcript
    });

    if (!result || !result.reply) {
        return "Ich habe dich nicht ganz verstanden. Kannst du das bitte wiederholen?";
    }

    return result.reply;
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

    let voice = await speak(greeting);

    if (!voice) {
        console.error("❌ Konnte Begrüßung nicht generieren");
        return res.type("text/xml").send(`
        <Response>
            <Say voice="alice">Hallo, ich bin Klaudi von HOMQ.</Say>
            <Redirect>/twilio</Redirect>
        </Response>`);
    }

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
// SPRACHAUFSAGE VERARBEITEN
// ------------------------------------------------------------
app.post("/process", async (req, res) => {
    try {
        const phone = req.body.From;
        const audioUrl = req.body.RecordingUrl + ".wav";

        console.log("🎧 Audio URL:", audioUrl);

        const transcript = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: audioUrl,
            response_format: "text"
        });

        console.log("📝 Transcript:", transcript);

        const caller = await getOrCreateCaller(phone);

        // Name speichern, falls leer & kurz
        if (caller && !caller.name && transcript.length < 25) {
            await base44Function("callerUpdate", {
                id: caller.id,
                name: transcript.trim()
            });
        }

        const reply = await askKlaudi(caller, transcript);

        let voice = await speak(reply);

        if (!voice) {
            return res.type("text/xml").send(`
            <Response>
                <Say voice="alice">Entschuldigung, ich konnte keine Antwort generieren.</Say>
                <Redirect>/twilio</Redirect>
            </Response>`);
        }

        const xml = `
        <Response>
            <Play>data:audio/mp3;base64,${voice}</Play>
            <Redirect>/twilio</Redirect>
        </Response>`;

        res.type("text/xml").send(xml);

    } catch (err) {
        console.error("❌ Prozessfehler:", err);

        return res.type("text/xml").send(`
        <Response>
            <Say voice="alice">Entschuldigung, da ging etwas schief.</Say>
            <Redirect>/twilio</Redirect>
        </Response>`);
    }
});

// ------------------------------------------------------------
// SERVER
// ------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 KLAUDI 5.1 Voice Agent läuft auf Port ${PORT}`);
});
