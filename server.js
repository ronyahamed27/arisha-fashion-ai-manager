import "dotenv/config";
import express from "express";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 10000;

const {
  VERIFY_TOKEN,
  META_APP_SECRET,
  PAGE_ACCESS_TOKEN,
  PAGE_ID,
  META_GRAPH_VERSION = "v26.0",
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4.1-mini",
} = process.env;

// Keep the raw request bytes so Meta's signature can be verified.
app.use(express.raw({ type: "application/json", limit: "1mb" }));

app.get("/", (_req, res) => {
  res.status(200).json({
    service: "Aarisha Fashion Messenger AI",
    status: "running",
    webhook: "/webhook",
  });
});

// Meta webhook verification (GET).
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    console.log("Meta webhook verification successful.");
    return res.status(200).send(String(challenge));
  }
  return res.sendStatus(403);
});

function validMetaSignature(rawBody, signatureHeader) {
  if (!META_APP_SECRET || !signatureHeader?.startsWith("sha256=")) return false;

  const received = signatureHeader.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", META_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(received, "hex"),
    Buffer.from(expected, "hex")
  );
}

async function askAarishaAI(customerText) {
  if (!OPENAI_API_KEY) {
    return "ধন্যবাদ Aarisha Fashion-এ যোগাযোগ করার জন্য। আমাদের টিম শিগগিরই আপনাকে সাহায্য করবে।";
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "তুমি Aarisha Fashion-এর ভদ্র, সহায়ক বাংলা অনলাইন শপ সহকারী। " +
        "সংক্ষিপ্ত ও পরিষ্কার বাংলায় উত্তর দাও। কেবল গ্রাহকের দেওয়া তথ্য এবং " +
        "নিশ্চিত পণ্যের তথ্য ব্যবহার করো। কোনো পণ্যের দাম, স্টক, ডেলিভারি চার্জ, " +
        "অর্ডার নম্বর বা নীতিমালা জানা না থাকলে বানিয়ে বলবে না; প্রয়োজনে " +
        "মানব প্রতিনিধির সাহায্য নেওয়ার কথা বলবে। এই সিস্টেম এখনো অর্ডার " +
        "সংরক্ষণ করে না, তাই অর্ডার সম্পন্ন হয়েছে এমন দাবি করবে না।",
      input: customerText,
      max_output_tokens: 220,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("OpenAI API error:", data?.error?.message || response.status);
    throw new Error("AI response request failed");
  }

  const text = (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text || "ধন্যবাদ! আপনার প্রশ্নটি আমরা পেয়েছি। একটু পর আবার চেষ্টা করুন।";
}

async function sendMessengerReply(psid, text) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error("PAGE_ACCESS_TOKEN is missing; reply not sent.");
    return;
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text: String(text).slice(0, 1900) },
      access_token: PAGE_ACCESS_TOKEN,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("Messenger send error:", data?.error?.message || response.status);
    throw new Error("Messenger reply failed");
  }
}

const recentlyHandled = new Set();

async function handleMessagingEvent(event) {
  const psid = event?.sender?.id;
  const message = event?.message;

  // Ignore Page echoes, delivery/read events, and non-text messages for this starter.
  if (!psid || !message || message.is_echo || typeof message.text !== "string") return;

  // Avoid duplicate replies if Meta retries the same webhook event.
  if (message.mid && recentlyHandled.has(message.mid)) return;
  if (message.mid) {
    recentlyHandled.add(message.mid);
    if (recentlyHandled.size > 5000) recentlyHandled.clear();
  }

  try {
    const reply = await askAarishaAI(message.text);
    await sendMessengerReply(psid, reply);
    console.log("Reply sent to a Messenger user.");
  } catch (error) {
    console.error("Message handling failed:", error.message);
  }
}

app.post("/webhook", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!validMetaSignature(rawBody, req.get("x-hub-signature-256"))) {
    return res.sendStatus(403);
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.sendStatus(400);
  }

  if (body.object !== "page") return res.sendStatus(404);

  // Acknowledge quickly; process events after returning HTTP 200 to Meta.
  res.sendStatus(200);

  for (const entry of body.entry || []) {
    if (PAGE_ID && entry.id && entry.id !== PAGE_ID) continue;
    for (const event of entry.messaging || []) {
      void handleMessagingEvent(event);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aarisha Fashion webhook server listening on port ${PORT}`);
});
