//-----------------------------------------------------------
// KLAUDI 3.0 – High-End Voice Assistant für HOMQ
// Voll integriert mit Base44 AI (klaudiChat) + Tickets
// Nova Voice, automatische User-Erstellung, flüssiger Ablauf
//-----------------------------------------------------------

import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;

//-----------------------------------------------
// 1) OpenAI Client
//-----------------------------------------------
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

//-----------------------------------------------
// 2) Base44 Generic Call
//-----------------------------------------------
async function base44Call(path, method = "GET", body = null) {
    const res = await fetch(`${process.env.BASE44_URL}${path}`, {
        method,
        headers: {
            "Authorization": `Bearer ${process.env.BASE44_API_KEY}`,
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

//-----------------------------------------------
// 3) User suchen oder automatisch anlegen
//-----------------------------------------------
async function getOrCreateUserByPhone(phone) {
    console.log("🔍 Suche Benutzer:", phone);

    // 1) Suche per Filter
    const filter = encodeURIComponent(JSON.stringify({ phone_number: phone }));
    const result = await base44Call(`/api/entities/User?where=${filter}`);

    if (result && result.length > 0) {
        console.log("✅ Benutzer gefunden:", result[0]);
        return result[0];
    }

    console.log("⚠️ Kein Benutzer – erstelle neuen…");

    // 2) Neuen Benutzer anlegen
    const newUser = await base44Call(`/api/entities/User`, "POST", {
        data: {
            phone_number: phone,
            full_name: "Unbekannt",
            roleLevel: "manager"
        }
    });

    console.log("✨ Neuer Benutzer erstellt:", newUser);
    return newUser;
}

//-----------------------------------------------
// 4) Base44 KI (dein Klaudi Prompt)
//-----------------------------------------------
async function askKlaudiAI(user, transcript) {
    const response = await base44Call(
        `/api/functions/klaudiChat`,
        "POST",
        {
            user,
            message: transcript
        }
    );

    if (!response) {
        return "Es gab ein Problem in der Verarbeitung.";
    }

    return response.reply ?? "Ich habe dich verstanden.";
}

//-----------------------------------------------
// 5) Text → Nova Voice
//-----------------------------------------------
async function speak(text) {
    const audio = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        speed: 0.94,
        input: text
    });

    return Buffer.from(await audio.arrayBuffer()).toString("base64");
}

//-----------------------------------------------
// 6) ERSTER ANRUF – Begrüßung
//-----------------------------------------------
app.post("/twilio", async (req, res) => {
    const phone = req.body.From;
    const user = await getOrCreateUserByPhone(phone);

    const greeting = user.full_name === "Unbekannt"
        ? "Hallo, ich bin Klaudi von HOMQ. Wie darf ich dich nennen?"
        : `Hallo ${user.full_name}, ich bin Klaudi von HOMQ. Wie kann ich dir helfen?`;

    const voice = await speak(greeting);

    const xml = `
    <Response>
        <Play>data:audio/mp3;base64,${voice}</Play>
        <Record 
            action="/processSpeech"
            playBeep="false"
            maxLength="12"
            trim="trim-silence"
        />
    </Response>`;

    res.set("Content-Type", "text/xml");
    return res.send(xml);
});

//-----------------------------------------------
// 7) VERARBEITUNG – Transkription + KI + Antwort
//-----------------------------------------------
app.post("/processSpeech", async (req, res) => {
    try {
        const phone = req.body.From;
        const audioUrl = req.body.RecordingUrl + ".wav";

        console.log("🎧 Neue Aufnahme:", audioUrl);

        // TRANSKRIPTION
        const transcript = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: audioUrl,
            response_format: "text"
        });

        console.log("📝 Transkript:", transcript);

        const user = await getOrCreateUserByPhone(phone);

        // BASE44 KI (dein Klaudi Prompt)
        const klaudiResponse = await askKlaudiAI(user, transcript);

        // TTS
        const voice = await speak(klaudiResponse);

        const xml = `
        <Response>
            <Play>data:audio/mp3;base64,${voice}</Play>
            <Redirect>/twilio</Redirect>
        </Response>`;

        res.set("Content-Type", "text/xml");
        return res.send(xml);

    } catch (err) {
        console.error("❌ ERROR:", err);

        return res.send(`
        <Response>
            <Say>Es tut mir leid, das konnte ich nicht verstehen.</Say>
            <Redirect>/twilio</Redirect>
        </Response>`);
    }
});

//-----------------------------------------------
// 8) SERVER START
//-----------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 KLAUDI Voice Agent läuft auf Port ${PORT}`);
});
