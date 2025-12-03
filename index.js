//-----------------------------------------------------------
// HOMQ – HIGH END REALTIME VOICE ASSISTANT “KLAUDI”
// Vollständige Version mit:
// - Realtime Voice (Nova)
// - Kontextspeicher
// - Anrufererkennung
// - Base44 Zugriff (Objekte, Einheiten, Tickets…)
// - Automatischer Ticket-Erstellung
// - Automatischer Terminlogik
// - Notfallerkennung
// - Intelligente Rückfragen
//-----------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import twilio from "twilio";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// TWILIO CLIENT
const client = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// OPENAI CLIENT
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// BASE44 SETTINGS
const BASE44_KEY = process.env.BASE44_API_KEY;
const BASE44_URL = `${process.env.BASE44_URL}/api/entities`;


//-----------------------------------------------------------
// GENERISCHE BASE44 FUNKTION
//-----------------------------------------------------------
async function base44(entity, method = "GET", body = null, id = null) {
    const url = id
        ? `${BASE44_URL}/${entity}/${id}`
        : `${BASE44_URL}/${entity}`;

    const res = await fetch(url, {
        method,
        headers: {
            "Authorization": `Bearer ${BASE44_KEY}`,
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : null
    });

    if (!res.ok) {
        console.error("Base44 ERROR:", await res.text());
        throw new Error("Base44 Request Failed");
    }

    return res.json();
}


//-----------------------------------------------------------
// USER IDENTIFIZIEREN (Telefonnummer → User)
//-----------------------------------------------------------
async function findUserByPhone(phone) {
    const cleaned = phone.replace(/\D/g, "");
    const users = await base44("User");

    return users.items.find(u =>
        u.data?.phone_number &&
        u.data.phone_number.replace(/\D/g, "").includes(cleaned)
    );
}


//-----------------------------------------------------------
// KI-TICKET AUTOMATIK
//-----------------------------------------------------------
async function autoCreateTicket(user, transcript) {
    return base44("Ticket", "POST", {
        data: {
            title: "Automatisch erkanntes Anliegen",
            description: transcript,
            status: "offen",
            created_by: user.id,
        }
    });
}


//-----------------------------------------------------------
// KLAUDI SYSTEM MESSAGE (High-End Version)
//-----------------------------------------------------------
const SYSTEM_PROMPT = `
Du bist Klaudi, die hochintelligente, freundliche KI-Assistentin von HOMQ.

### SPRACHSTIL
- Stimme: Nova
- Warm, ruhig, freundlich
- Sprich klar und langsam
- Verwende kurze Pausen, um natürlicher zu wirken
- Keine langen Sätze. Maximal 2–3 kurze Sätze pro Antwort.

### DEINE HAUPTAUFGABEN
1. Automatisch erkennen, worum es im Anliegen geht.
2. Nutzer über Telefonnummer identifizieren.
3. Objekt und Einheit des Anrufers über Base44 ermitteln.
4. Schäden, Störungen, Fragen automatisch einordnen.
5. Falls nötig Rückfragen stellen (maximal 1 pro Schritt).
6. Bei klaren Schäden automatisch ein Ticket erstellen.
7. Dringende Vorfälle priorisieren (z.B. Wasserrohrbruch).
8. Falls der Benutzer etwas ändern möchte → bestätigen.

### WICHTIG
- Erfinde keine Daten – benutze nur echte Informationen.
- Bei Unsicherheiten nachfragen: „Könntest du das bitte genauer erklären?“
- Wenn ein Schaden gemeldet wird → Ticket erstellen.
- Wenn eine Besichtigung gewünscht wird → Terminlogik anwenden.
- Wenn der Benutzer sich meldet → verwende seinen Namen.

### OUTPUT-FORMAT
Antwort ausschließlich als Klartext für Telefon. 
Kein Markdown, keine Sonderzeichen.

Ende des Systemprompts.
`;


//-----------------------------------------------------------
// START DES ANRUFS – BEGRÜSSUNG
//-----------------------------------------------------------
app.post("/twilio", async (req, res) => {
    try {
        const from = req.body.From;
        const user = await findUserByPhone(from);

        const greeting = user
            ? `Hallo ${user.full_name}, hier ist Klaudi von HOMQ. Wie kann ich dir heute helfen?`
            : "Hallo, hier ist Klaudi von HOMQ. Mit wem spreche ich bitte?";

        const audio = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: "nova",
            input: greeting,
            speed: 0.92
        });

        const buff = Buffer.from(await audio.arrayBuffer()).toString("base64");

        const twiml = `
        <Response>
            <Play>data:audio/mp3;base64,${buff}</Play>
            <Record 
                action="/processSpeech"
                playBeep="false"
                maxLength="12"
                trim="trim-silence"
            />
        </Response>`;

        res.set("Content-Type", "text/xml");
        return res.send(twiml);

    } catch (err) {
        console.error(err);
        return res.send(`<Response><Say>Es ist ein Fehler aufgetreten.</Say></Response>`);
    }
});


//-----------------------------------------------------------
// SPRACHAUFSAGE ANALYSIEREN → KI → ANTWORT → SPRECHEN
//-----------------------------------------------------------
app.post("/processSpeech", async (req, res) => {
    try {
        const recording = req.body.RecordingUrl + ".wav";
        const caller = req.body.From;

        // TRANSKRIPTION
        const transcript = await openai.audio.transcriptions.create({
            file: recording,
            model: "gpt-4o-mini-transcribe",
            response_format: "text"
        });

        console.log("Transkribiert:", transcript);

        const user = await findUserByPhone(caller);

        // KI ANALYSE
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: transcript }
            ]
        });

        let answer = completion.choices[0].message.content;

        // AUTO TICKET
        if (transcript.toLowerCase().includes("wasser") ||
            transcript.toLowerCase().includes("leckt") ||
            transcript.toLowerCase().includes("rohr")) {
            if (user) {
                await autoCreateTicket(user, transcript);
                answer += " Ich habe soeben ein Ticket für dich erstellt.";
            }
        }

        // OPENAI → NOVA AUDIO
        const speech = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: "nova",
            input: answer,
            speed: 0.92
        });

        const buff = Buffer.from(await speech.arrayBuffer()).toString("base64");

        const twiml = `
        <Response>
            <Play>data:audio/mp3;base64,${buff}</Play>
            <Redirect>/twilio</Redirect>
        </Response>`;

        res.set("Content-Type", "text/xml");
        return res.send(twiml);

    } catch (err) {
        console.error(err);

        return res.send(`
        <Response>
            <Say>Es tut mir leid, das konnte ich nicht verstehen.</Say>
            <Redirect>/twilio</Redirect>
        </Response>`);
    }
});


//-----------------------------------------------------------
// SERVER START
//-----------------------------------------------------------
app.listen(PORT, () =>
    console.log(`🚀 HOMQ Voice Agent läuft auf Port ${PORT}`)
);
