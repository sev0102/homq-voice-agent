export function buildWelcomeTwiML() {
    return `
    <Response>
      <Say voice="Polly.Joanna">Hallo, hier ist der HOMIQ Voice Assistent. Wie kann ich Ihnen helfen?</Say>
      <Pause length="1" />
      <Gather input="speech" action="/twilio/gather" method="POST" speechTimeout="auto" />
    </Response>
  `;
}
