import VoiceService from "../services/voice.service.js";

const twilioController = {

    // 1️⃣ When a new call starts:
    async handleIncomingCall(req, res) {
        try {
            const twiml = await VoiceService.onCallStart(req.body);
            res.set("Content-Type", "text/xml");
            return res.send(twiml);
        } catch (err) {
            console.error("❌ handleIncomingCall error:", err);
            return res.status(500).send("Internal Server Error");
        }
    },

    // 2️⃣ When Twilio sends STT / speech recognition data:
    async handleGatherEvent(req, res) {
        try {
            const twiml = await VoiceService.onTranscript(req.body);
            res.set("Content-Type", "text/xml");
            return res.send(twiml);
        } catch (err) {
            console.error("❌ handleGatherEvent error:", err);
            return res.status(500).send("Internal Server Error");
        }
    },

    // 3️⃣ Call status updates (completed, busy, etc.)
    async handleStatusCallback(req, res) {
        try {
            await VoiceService.onStatusUpdate(req.body);
            return res.sendStatus(200);
        } catch (err) {
            console.error("❌ handleStatusCallback error:", err);
            return res.sendStatus(500);
        }
    }

};

export default twilioController;
