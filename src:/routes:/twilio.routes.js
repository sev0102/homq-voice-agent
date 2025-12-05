import express from "express";
import twilioController from "../controllers/twilio.controller.js";

const router = express.Router();

// Incoming voice call from Twilio:
router.post("/voice", twilioController.handleIncomingCall);

// Speech-to-Text (Gather events / media streams):
router.post("/gather", twilioController.handleGatherEvent);

// Call status updates (completed, busy, no-answer, failed):
router.post("/status", twilioController.handleStatusCallback);

export default router;
