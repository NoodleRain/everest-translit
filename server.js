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

// Your LibreTranslate server URL
const LIBRE_URL = process.env.LIBRE_URL || 
    "https://libretranslate-production-b4f1.up.railway.app/translate";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ----------------------------------------------------------------
// DETECT NON-LATIN SCRIPTS
// ----------------------------------------------------------------
function isNonLatin(text)
{
    // Check for Cyrillic, CJK, Arabic, Hebrew, Hindi, Thai, Korean etc
    return /[\u0400-\u04FF]/.test(text) ||  // Cyrillic (Russian, Ukrainian)
           /[\u4E00-\u9FFF]/.test(text) ||  // Chinese
           /[\u3040-\u309F]/.test(text) ||  // Japanese Hiragana
           /[\u30A0-\u30FF]/.test(text) ||  // Japanese Katakana
           /[\uAC00-\uD7AF]/.test(text) ||  // Korean
           /[\u0600-\u06FF]/.test(text) ||  // Arabic
           /[\u0900-\u097F]/.test(text) ||  // Hindi/Devanagari
           /[\u0E00-\u0E7F]/.test(text) ||  // Thai
           /[\u0590-\u05FF]/.test(text) ||  // Hebrew
           /[\u0370-\u03FF]/.test(text);    // Greek
}

// ----------------------------------------------------------------
// TRANSLITERATE TEXT TO LATIN PHONETICS
// ----------------------------------------------------------------
function toPhonetic(text)
{
    try {
        return transliterate(text);
    } catch(e) {
        return text;
    }
}

// ----------------------------------------------------------------
// FORMAT OUTPUT
// Format: "Phonetic (Original)" or just translated if Latin
// ----------------------------------------------------------------
function formatOutput(translated, targetLang)
{
    if (!isNonLatin(translated)) {
        // Already Latin script -- return as is
        return translated;
    }

    // Non-Latin -- add phonetic version
    const phonetic = toPhonetic(translated);

    // If transliteration worked and is different from original
    if (phonetic && phonetic !== translated) {
        return phonetic + " (" + translated + ")";
    }

    // Fallback -- just return original
    return translated;
}

// ----------------------------------------------------------------
// MAIN TRANSLATE ENDPOINT
// POST /translate
// Body: q=text&source=en&target=ru&format=text
// ----------------------------------------------------------------
app.post("/translate", async (req, res) => {
    const { q, source, target, format } = req.body;

    if (!q || !target) {
        return res.status(400).json({ 
            error: "Missing required fields: q and target" 
        });
    }

    try {
        // Step 1 -- Send to LibreTranslate
        const libreResponse = await axios.post(LIBRE_URL, {
            q:       q,
            source:  source || "auto",
            target:  target,
            format:  format || "text"
        }, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });

        const translated = libreResponse.data.translatedText;

        // Step 2 -- Transliterate if non-Latin
        const finalText = formatOutput(translated, target);

        // Step 3 -- Return in same format SL expects
        return res.json({ translatedText: finalText });

    } catch (err) {
        console.error("Translation error:", err.message);

        // If LibreTranslate is down return error
        return res.status(500).json({ 
            error: "Translation service unavailable",
            details: err.message
        });
    }
});

// ----------------------------------------------------------------
// HEALTH CHECK ENDPOINT
// ----------------------------------------------------------------
app.get("/", (req, res) => {
    res.json({
        service: "Everest Transliteration Service v1.0",
        status:  "online",
        endpoints: {
            translate: "POST /translate",
            health:    "GET /"
        }
    });
});

// ----------------------------------------------------------------
// VERSION CHECK ENDPOINT
// Used by HUD for future auto-update notifications
// ----------------------------------------------------------------
app.get("/version", (req, res) => {
    res.json({
        version:     "2.0",
        name:        "Everest Universal Translator",
        updateAvail: false,
        message:     "You are running the latest version!"
    });
});

// ----------------------------------------------------------------
// START SERVER
// ----------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
    console.log("================================================");
    console.log("  Everest Transliteration Service v1.0");
    console.log("  Running on port " + PORT);
    console.log("  LibreTranslate URL: " + LIBRE_URL);
    console.log("================================================");
});
