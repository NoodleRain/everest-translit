// ================================================================
// BABEL PRO AI -- Language Services Server v2.0
// By Baula16
// ================================================================
// ENDPOINTS:
//   POST /translate  -- translate text (4 API fallbacks, never fails)
//   POST /mood       -- AI mood detection
//   POST /flirt      -- flirt detection with confidence score
//   POST /language   -- detect what language text is in
//   POST /summary    -- summarize a conversation
//   GET  /version    -- version check for HUD auto-updater
//   GET  /           -- health check
// ================================================================
// TRANSLATION PRIORITY (tries in order, skips failed ones):
//   1. Lingva.ml     -- completely free, no rate limits, no key
//   2. Argos Public  -- open source, no key, no rate limits
//   3. MyMemory      -- 1000/day free but spread across calls
//   4. LibreTranslate -- self-hosted fallback
// ================================================================

const express = require("express");
const axios   = require("axios");
const { transliterate } = require("transliteration");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================================================================
// TRANSLATION API URLS
// ================================================================
const LIBRE_URL   = process.env.LIBRE_URL || "https://libretranslate-production-b4f1.up.railway.app/translate";
const LINGVA_BASE = "https://lingva.ml/api/v1";
const ARGOS_URL   = "https://translate.argosopentech.com/translate";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

// Language code mapping -- some APIs use different codes
function normLang(code) {
    const map = { "zh": "zh", "pt": "pt", "no": "nb", "auto": "en" };
    return map[code] || code;
}

// ================================================================
// CORE TRANSLATE FUNCTION
// Tries 4 APIs in order -- returns first success
// Never throws -- always returns something
// ================================================================
async function translateText(q, source, target) {
    if (!q || q.trim() === "") return q;
    const src = (source === "auto" || !source) ? "en" : normLang(source);
    const tgt = normLang(target);

    // ── API 1: Lingva.ml ── completely free, no rate limit, no key ──
    try {
        const url = `${LINGVA_BASE}/${src}/${tgt}/${encodeURIComponent(q)}`;
        const r = await axios.get(url, { timeout: 8000 });
        if (r.data && r.data.translation && r.data.translation.trim()) {
            return r.data.translation;
        }
    } catch(e) {
        console.log(`Lingva failed (${src}->${tgt}):`, e.message);
    }

    // ── API 2: Argos Translate public ── open source, no key, no limit ──
    try {
        const r = await axios.post(ARGOS_URL, {
            q, source: src, target: tgt
        }, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000
        });
        if (r.data && r.data.translatedText && r.data.translatedText.trim()) {
            return r.data.translatedText;
        }
    } catch(e) {
        console.log(`Argos failed (${src}->${tgt}):`, e.message);
    }

    // ── API 3: MyMemory ── 1000/day free, good quality ──
    try {
        const langpair = `${src}|${tgt}`;
        const url = `${MYMEMORY_URL}?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(langpair)}`;
        const r = await axios.get(url, { timeout: 8000 });
        if (r.data && r.data.responseStatus === 200 &&
            r.data.responseData && r.data.responseData.translatedText &&
            r.data.responseData.translatedText.trim()) {
            return r.data.responseData.translatedText;
        }
    } catch(e) {
        console.log(`MyMemory failed (${src}->${tgt}):`, e.message);
    }

    // ── API 4: LibreTranslate self-hosted ── last resort ──
    try {
        const r = await axios.post(LIBRE_URL, {
            q, source: src, target: tgt, format: "text", api_key: ""
        }, {
            headers: { "Content-Type": "application/json" },
            timeout: 12000
        });
        if (r.data && r.data.translatedText && r.data.translatedText.trim()) {
            return r.data.translatedText;
        }
    } catch(e) {
        console.log(`LibreTranslate failed (${src}->${tgt}):`, e.message);
    }

    // All APIs failed -- return original with note
    console.error(`All 4 APIs failed for: "${q.substring(0,40)}" (${src}->${tgt})`);
    return q; // return original rather than erroring out
}

// ================================================================
// TRANSLITERATION
// Converts non-Latin scripts to readable phonetic Latin
// ================================================================
function isNonLatin(text) {
    return /[\u0400-\u04FF]/.test(text) || // Cyrillic
           /[\u4E00-\u9FFF]/.test(text) || // Chinese
           /[\u3040-\u309F]/.test(text) || // Hiragana
           /[\u30A0-\u30FF]/.test(text) || // Katakana
           /[\uAC00-\uD7AF]/.test(text) || // Korean
           /[\u0600-\u06FF]/.test(text) || // Arabic
           /[\u0900-\u097F]/.test(text) || // Hindi/Devanagari
           /[\u0E00-\u0E7F]/.test(text) || // Thai
           /[\u0590-\u05FF]/.test(text) || // Hebrew
           /[\u0370-\u03FF]/.test(text);   // Greek
}

function formatOutput(translated) {
    if (!translated) return translated;
    if (!isNonLatin(translated)) return translated;
    try {
        const phonetic = transliterate(translated);
        if (phonetic && phonetic !== translated)
            return phonetic + " (" + translated + ")";
    } catch(e) {}
    return translated;
}

// ================================================================
// MOOD DETECTION ENGINE
// Pattern matching on English text -- no external API needed
// ================================================================
const MOOD_PATTERNS = {
    flirting: [
        /\b(beautiful|gorgeous|sexy|cute|handsome|pretty|hot|attractive|stunning)\b/i,
        /\b(wink|kiss|hug|cuddle|snuggle|caress|touch)\b/i,
        /\b(like you|love you|adore you|fancy you|want you)\b/i,
        /\b(date|together|mine|yours|us together)\b/i,
        /[;]\)|:\*|<3/,
        /\b(flirt|tease|seduce|charm|tempt)\b/i,
        /\b(come here|come over|stay with me|be mine)\b/i
    ],
    angry: [
        /\b(hate|angry|furious|mad|rage|annoyed|irritated|outraged)\b/i,
        /\b(stupid|idiot|fool|moron|dumb|shut up|get lost)\b/i,
        /\b(leave me alone|go away|stop it|enough|back off)\b/i,
        /[!]{3,}/
    ],
    sad: [
        /\b(sad|cry|tears|lonely|alone|miss|hurt|pain|sorry|grief)\b/i,
        /\b(depressed|unhappy|upset|devastated|heartbroken|miserable)\b/i,
        /\b(goodbye|leaving|never coming back|lost|gone forever)\b/i
    ],
    excited: [
        /\b(amazing|awesome|fantastic|incredible|wow|omg|yay|woah)\b/i,
        /\b(cant wait|so excited|thrilled|pumped|stoked|hyped)\b/i,
        /\b(best day|so good|love this|incredible|unbelievable)\b/i
    ],
    happy: [
        /\b(happy|great|good|wonderful|nice|enjoy|fun|glad|pleased)\b/i,
        /\b(thank|thanks|grateful|appreciate|blessed|lucky)\b/i,
        /\b(haha|lol|hehe|lmao|rofl|teehee)\b/i
    ],
    nervous: [
        /\b(nervous|anxious|worried|scared|afraid|fear|stress|panic)\b/i,
        /\b(not sure|maybe|perhaps|i think|i hope|what if|hopefully)\b/i,
        /\b(um|uh|err|hmm|well|i guess|sort of)\b/i
    ]
};

function detectMood(text) {
    const scores = { flirting:0, angry:0, sad:0, excited:0, happy:0, nervous:0 };
    for (const [mood, patterns] of Object.entries(MOOD_PATTERNS)) {
        for (const pattern of patterns) {
            const m = text.match(pattern);
            if (m) scores[mood] += m.length;
        }
    }
    let topMood = "neutral", topScore = 0;
    for (const [mood, score] of Object.entries(scores)) {
        if (score > topScore) { topScore = score; topMood = mood; }
    }
    const moodMap = {
        flirting: { emoji: "~", label: "FLIRTING", alert: true  },
        angry:    { emoji: "!", label: "ANGRY",    alert: true  },
        sad:      { emoji: ".", label: "SAD",      alert: false },
        excited:  { emoji: "*", label: "EXCITED",  alert: false },
        happy:    { emoji: "+", label: "HAPPY",    alert: false },
        nervous:  { emoji: "?", label: "NERVOUS",  alert: false },
        neutral:  { emoji: "-", label: "NEUTRAL",  alert: false }
    };
    return { mood: topMood, score: topScore, ...moodMap[topMood] };
}

// ================================================================
// FLIRT DETECTION ENGINE
// ================================================================
function detectFlirt(text) {
    let score = 0, flirtType = "none";
    const checks = [
        { p: /\b(beautiful|gorgeous|pretty|cute|hot|sexy|handsome|stunning)\b/i, pts: 30, t: "compliment" },
        { p: /\b(like you|love you|adore you|want you|need you|desire)\b/i,      pts: 40, t: "emotional"  },
        { p: /\b(kiss|hug|cuddle|touch|hold me|hold you)\b/i,                    pts: 35, t: "physical"   },
        { p: /[;]\)|:\*|<3/,                                                      pts: 25, t: "emoji"      },
        { p: /\b(date|together|meet me|come over|spend time)\b/i,                pts: 30, t: "invitation" },
        { p: /\b(wink|tease|flirt|seduce)\b/i,                                   pts: 40, t: "direct"     },
        { p: /\b(mine|yours|just us|we could|you and me)\b/i,                    pts: 20, t: "possessive" }
    ];
    for (const c of checks) {
        if (c.p.test(text)) { score += c.pts; flirtType = c.t; }
    }
    return {
        isFlirting:      score >= 30,
        confidence:      Math.min(score, 100),
        flirtConfidence: Math.min(score, 100),
        flirtType:       flirtType,
        type:            flirtType
    };
}

// ================================================================
// CONVERSATION SUMMARY
// ================================================================
function summarizeConversation(messages) {
    if (!messages || messages.length === 0) return "No conversation to summarize.";
    const speakers = [...new Set(messages.map(m => m.name).filter(Boolean))];
    const counts   = {};
    for (const m of messages) {
        if (m.name) counts[m.name] = (counts[m.name] || 0) + 1;
    }
    const allText = messages.map(m => m.text || "").join(" ").toLowerCase();
    const topics  = [];
    const topicMap = {
        "greeting": /\b(hello|hi|hey|welcome|good morning)\b/,
        "farewell": /\b(bye|goodbye|see you|later|ciao)\b/,
        "question": /\?/,
        "location": /\b(where|place|sim|region|land)\b/,
        "trading":  /\b(buy|sell|trade|lindens|price|cost)\b/,
        "roleplay": /\b(roleplay|rp|character|story)\b/,
        "help":     /\b(help|assist|support|problem|how)\b/,
        "romance":  /\b(love|beautiful|kiss|hug|together)\b/
    };
    for (const [topic, pattern] of Object.entries(topicMap)) {
        if (pattern.test(allText)) topics.push(topic);
    }
    return [
        messages.length + " messages",
        "speakers: " + (speakers.slice(0,3).join(", ") || "unknown"),
        "topics: " + (topics.join(", ") || "general"),
        Object.entries(counts).map(([n,c]) => n+":"+c).join(" ")
    ].join(" | ");
}

// ================================================================
// ROUTES
// ================================================================

// POST /translate -- main translation endpoint
// Works for both LITE (translation only) and PRO (all features)
// Unlimited usage -- 4 API fallbacks
app.post("/translate", async (req, res) => {
    const { q, source, target, format } = req.body;
    if (!q || !target)
        return res.status(400).json({ error: "Missing q or target" });
    try {
        const translated = await translateText(q, source || "auto", target);
        return res.json({ translatedText: formatOutput(translated) });
    } catch(err) {
        console.error("Translation endpoint error:", err.message);
        // Return original text rather than failing completely
        return res.json({ translatedText: q, error: err.message });
    }
});

// POST /mood -- mood + flirt detection for PRO intelligence features
app.post("/mood", async (req, res) => {
    const { q, source } = req.body;
    if (!q) return res.status(400).json({ error: "Missing q" });
    let text = q;
    // Translate to English for analysis if needed
    if (source && source !== "en" && source !== "auto") {
        text = await translateText(q, source, "en");
    }
    const mood  = detectMood(text);
    const flirt = detectFlirt(text);
    return res.json({
        mood:            mood.label,
        moodEmoji:       mood.emoji,
        alert:           mood.alert,
        isFlirting:      flirt.isFlirting,
        flirtConfidence: flirt.confidence,
        flirtType:       flirt.type
    });
});

// POST /flirt -- flirt only endpoint
app.post("/flirt", async (req, res) => {
    const { q, source } = req.body;
    if (!q) return res.status(400).json({ error: "Missing q" });
    let text = q;
    if (source && source !== "en" && source !== "auto") {
        text = await translateText(q, source, "en");
    }
    return res.json(detectFlirt(text));
});

// POST /language -- language detection
app.post("/language", async (req, res) => {
    const { q } = req.body;
    if (!q) return res.status(400).json({ error: "Missing q" });
    try {
        const detectUrl = LIBRE_URL.replace("/translate", "/detect");
        const r = await axios.post(detectUrl,
            { q },
            { headers: { "Content-Type": "application/json" }, timeout: 5000 }
        );
        if (r.data && r.data.length > 0) {
            const top = r.data[0];
            return res.json({ language: top.language, confidence: Math.round(top.confidence * 100) });
        }
    } catch(e) {}
    return res.json({ language: "unknown", confidence: 0 });
});

// POST /summary -- conversation summary for PRO recorder feature
app.post("/summary", async (req, res) => {
    let { messages } = req.body;
    if (!messages) return res.status(400).json({ error: "Missing messages" });
    if (typeof messages === "string") {
        try { messages = JSON.parse(messages); }
        catch(e) { return res.status(400).json({ error: "Invalid messages JSON" }); }
    }
    return res.json({ summary: summarizeConversation(messages) });
});

// GET /version -- version check for VersionChecker script
app.get("/version", (req, res) => {
    res.json({
        version:   "v2.0",
        product:   "BABEL PRO AI",
        creator:   "Baula16",
        endpoints: ["/translate", "/mood", "/flirt", "/language", "/summary", "/version"]
    });
});

// GET / -- health check
app.get("/", (req, res) => {
    res.json({
        service:   "BABEL PRO AI Language Services v2.0",
        status:    "online",
        creator:   "Baula16",
        endpoints: ["POST /translate","POST /mood","POST /flirt","POST /language","POST /summary","GET /version"]
    });
});

// START SERVER
app.listen(PORT, "0.0.0.0", () => {
    console.log(`BABEL PRO AI Language Services v2.0 running on port ${PORT}`);
    console.log(`LibreTranslate: ${LIBRE_URL}`);
    console.log(`Translation APIs: Lingva -> Argos -> MyMemory -> LibreTranslate`);
});
