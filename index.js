//-----------------------------------------------------------
// HOMQ – HIGH END REALTIME VOICE ASSISTANT “KLAUDI”
// Vollständige Produktionsversion
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

// -----------------------------------------------------
// RENDER PORT – Render setzt immer process.env.PORT
// -----------------------------------------------------
const PORT = process.env.PORT || 10000;

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
const BASE44_URL = process.env.BASE44_URL;
const BASE44_KEY = process.env.BASE44_API_KEY;


//-----------------------------------------------------------
// GENERIC BASE44 FUNCTION
//-----------------------------------------------------------
async function base44(entity, method = "GET", body = null, id = null) {
    const url = id
        ? `${BASE44_URL}/api/entities/${entity}/${id}`
        : `${BASE44_URL}/api/entities/${entity}`;

    const res = await fetch(url, {
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
}


//-----------------------------------------------------------
// USER LOOKUP → USER CREATE IF NOT EXISTS
//-----------------------------------------------------------
async function findOrCreateUser(phone) {
    try {
        console.log("📞 Suche nach User…", phone);

        // FIND USER BY PHONE
        const res = await fetch(
            `${BASE44_URL}/api/entities/User?where=${encodeURIComponent(
                JSON.stringify({ phone_number: phone })
            )}`,
            {
                headers: {
                    "Authorization": `Bearer ${BASE44_KEY}`,
                    "Content-Type": "application/json",
                }
            }
        );

        if (res.ok) {
            const json = await res.json();
            if (json.items?.length > 0) {
                console.log("✅ User gefunden:", json.items[0]);
                return json.items[0];
            }
        }

        console.log("➕ Keine User gefunden → neuer User wird erstellt");

        // CREATE USER IF NOT EXISTS
        const newUser = await base44("User", "POST", {
            data: {
                phone_number: phone,
                roleLevel: "manager"
            }
        });

        console.log("🎉 User erstellt:", newUser);
        return newUser;

    } catch (err) {
        console.error("❌ Fehler bei findOrCreateUser:", err);
        return null;
    }
}


//-----------------------------------------------------------
// HIGH-END PROMPT FÜR KLAUDI (PRODUKTIONSVERSION)
//-----------------------------------------------------------
const SYSTEM_PROMPT = `
Du bist Klaudi, die ruhige, freundliche, extrem intelligente Voice-Assistentin von HOMQ.

SPRACHSTIL:
- Stimme Nova (ruhig, warm, klar).
- Maximal 2–3 kurze Sätze pro Antwort.
- Keine technischen Details.
- Telefon-optimiert.

AUFGABEN:
1. Anliegen erkennen.
2. Rückfragen stellen, wenn unklar.
3. Schäden erkennen (Wasser, Heizung, Strom, Notfall).
4. Automatisch Tickets erstellen.
5. Wenn dringender Schaden → sofort Priorisierung aussprechen.
6. Wenn kein Benutzername vorhanden ist → höflich nach Namen fragen.
7. Wenn der Benutzer schon bekannt ist → ihn mit Namen begrüßen.
8. Daten niemals erfinden. Keine falschen Aussagen.

OUTPUT:
- Nur Klartext. Keine Formatierung.
`;


//-----------------------------------------------------------
// TWILIO – CALL ENTRY POINT
//-----------------------------------------------------------
app.post("/twilio", async (req, res) => {
    try {
        const phone = req.body.From;
        const user = await findOrCreateUser(phone);

        const greeting = user?.data?.full_name
            ? `Hallo ${user.data.full_name}, hier ist Klaudi von HOMQ. Wie kann ich dir helfen?`
            : `Hallo, hier ist Klaudi von HOMQ. Wie darf ich dich nennen?`;

        // TTS → Nova Stimme
        const audio = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: "nova",
            input: greeting,
            speed: 0.92
        });

        const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");

        const twiml = `
<Response>
    <Play>data:audio/mp3;base64,${base64}</Play>
    <Record 
        action="/process"
        playBeep="false"
        trim="trim-silence"
        maxLength="15"
    />
</Response>`;

        res.set("Content-Type", "text/xml");
        res.send(twiml);

    } catch (err) {
        console.error(err);
        res.send(`<Response><Say>Es ist ein Fehler aufgetreten.</Say></Response>`);
    }
});


//-----------------------------------------------------------
// MAIN LOGIC → TRANSCRIBE → AI → TTS → LOOP
//-----------------------------------------------------------
app.post("/process", async (req, res) => {
    try {
        const phone = req.body.From;
        const recording = req.body.RecordingUrl + ".wav";

        // --- SPEECH → TEXT ---
        const transcript = await openai.audio.transcriptions.create({
            file: recording,
            model: "gpt-4o-mini-transcribe",
            response_format: "text"
        });

        console.log("🎤 TRANSKRIPT:", transcript);

        // --- KI-ANALYSE ---
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: transcript }
            ]
        });

        let answer = completion.choices[0].message.content;

        // AUTOMATISCHE SCHADENERKENNUNG
        if (transcript.match(/wasser|rohr|leck|heizung|brand|strom/i)) {
            answer += " Ich habe dein Anliegen als dringenden Schaden erkannt und leite sofort alles ein.";
        }

        // --- TEXT → SPRACHE (Nova) ---
        const speech = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: "nova",
            input: answer,
            speed: 0.9
        });

        const base64 = Buffer.from(await speech.arrayBuffer()).toString("base64");

        const twiml = `
<Response>
    <Play>data:audio/mp3;base64,${base64}</Play>
    <Redirect>/twilio</Redirect>
</Response>`;

        res.set("Content-Type", "text/xml");
        res.send(twiml);

    } catch (err) {
        console.error("❌ Fehler in /process:", err);

        res.send(`
<Response>
    <Say>Es tut mir leid, ich konnte das nicht verstehen.</Say>
    <Redirect>/twilio</Redirect>
</Response>`);
    }
});


//-----------------------------------------------------------
// SERVER START
//-----------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 HOMQ Voice Agent „Klaudi“ läuft auf Port ${PORT}`);
});
