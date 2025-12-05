import { buildWelcomeTwiML } from "../voice/router.js";

const VoiceService = {

    async onCallStart(data) {
        console.log("📞 Incoming call:", data);
        return buildWelcomeTwiML();
    },

    async onTranscript(data) {
        console.log("🗣️ Transcript event:", data);
        // später: AI Antwort generieren
        return buildWelcomeTwiML();
    },

    async onStatusUpdate(data) {
        console.log("📊 Call status:", data.CallStatus);
        return true;
    }

};

export default VoiceService;
