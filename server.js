// ================================================================
// EVEREST TRANSLITERATION SERVICE v1.0
// Middleware between LibreTranslate and Second Life
// Translates AND transliterates non-Latin scripts
// ================================================================
// WHAT IT DOES:
//   1. Receives text + language from SL HUD
//   2. Sends to LibreTranslate for translation
//   3. Detects if result is non-Latin script
//   4. Transliterates to phonetic Latin if needed
//   5. Returns: "Privet! (Hello!)" format back to SL
// ================================================================

const express = require("express");
const axios   = require("axios");
const { transliterate } = require("transliteration");

const app  = express();
const PORT = process.env.PORT || 3000;

const LIBRE_URL = process.env.LIBRE_URL ||
    "https://libretranslate-production-b4f1.up.railway.app/translate";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function isNonLatin(text)
{
    return /[\u0400-\u04FF]/.test(text) ||
           /[\u4E00-\u9FFF]/.test(text) ||
           /[\u3040-\u309F]/.test(text) ||
           /[\u30A0-\u30FF]/.test(text) ||
           /[\uAC00-\uD7AF]/.test(text) ||
           /[\u0600-\u06FF]/.test(text) ||
           /[\u0900-\u097F]/.test(text) ||
           /[\u0E00-\u0E7F]/.test(text) ||
           /[\u0590-\u05FF]/.test(text) ||
           /[\u0370-\u03FF]/.test(text);
}

function toPhonetic(text)
{
    try { return transliterate(text); }
    catch(e) { return text; }
}

function formatOutput(translated)
{
    if (!isNonLatin(translated)) return translated;
    const phonetic = toPhonetic(translated);
    if (phonetic && phonetic !== translated)
        return phonetic + " (" + translated + ")";
    return translated;
}

app.post("/translate", async (req, res) => {
    const { q, source, target, format } = req.body;
    if (!q || !target)
        return res.status(400).json({ error: "Missing q or target" });
    try {
        const response = await axios.post(LIBRE_URL, {
            q:      q,
            source: source || "auto",
            target: target,
            format: format || "text"
        }, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });
        const translated = response.data.translatedText;
        const finalText  = formatOutput(translated);
        return res.json({ translatedText: finalText });
    } catch (err) {
        console.error("Error:", err.message);
        return res.status(500).json({ error: "Translation failed", details: err.message });
    }
});

app.get("/", (req, res) => {
    res.json({ service: "Everest Translit Service v1.0", status: "online" });
});

app.get("/version", (req, res) => {
    res.json({ version: "2.0", updateAvail: false, message: "Latest version!" });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Everest Translit Service running on port " + PORT);
});
