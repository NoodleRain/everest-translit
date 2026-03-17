// ================================================================
// EVEREST TRANSLATION PRO -- SERVER v2.0
// By Varg Lightfoot
// ================================================================
// ENDPOINTS:
//   POST /translate  -- translate + transliterate all languages
//   POST /mood       -- detect mood: happy/sad/angry/flirting/excited
//   POST /flirt      -- flirt detection with confidence score
//   POST /language   -- detect what language text is in
//   POST /summary    -- summarize a conversation
//   GET  /version    -- version check for HUD auto-updater
//   GET  /           -- health check
// ================================================================

const express  = require("express");
const axios    = require("axios");
const { transliterate } = require("transliteration");

const app  = express();
const PORT = process.env.PORT || 3000;

const LIBRE_URL = process.env.LIBRE_URL ||
    "https://libretranslate-production-b4f1.up.railway.app/translate";

// MyMemory fallback -- free public API, no install needed
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";

async function translateText(q, source, target) {
    // Try MyMemory first -- always available
    try {
        const langPair = (source === "auto" ? "en" : source) + "|" + target;
        const url = MYMEMORY_URL + "?q=" + encodeURIComponent(q) + "&langpair=" + langPair;
        const r = await axios.get(url, { timeout: 10000 });
        if (r.data && r.data.responseStatus === 200 && r.data.responseData) {
            return r.data.responseData.translatedText;
        }
    } catch(e) {
        console.log("MyMemory failed:", e.message);
    }
    // Fallback to LibreTranslate
    try {
        const r = await axios.post(LIBRE_URL, {
            q, source: source || "auto", target, format: "text", api_key: ""
        }, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
        return r.data.translatedText;
    } catch(e) {
        throw new Error("All translation services failed: " + e.message);
    }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================================================================
// TRANSLITERATION HELPERS
// ================================================================

function isNonLatin(text) {
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

function formatOutput(translated) {
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
// No external API needed -- pattern matching on English text
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
        flirting: { emoji: "~", label: "FLIRTING",  alert: true  },
        angry:    { emoji: "!", label: "ANGRY",     alert: true  },
        sad:      { emoji: ".", label: "SAD",       alert: false },
        excited:  { emoji: "*", label: "EXCITED",   alert: false },
        happy:    { emoji: "+", label: "HAPPY",     alert: false },
        nervous:  { emoji: "?", label: "NERVOUS",   alert: false },
        neutral:  { emoji: "-", label: "NEUTRAL",   alert: false }
    };

    return { mood: topMood, score: topScore, ...moodMap[topMood] };
}

// ================================================================
// FLIRT DETECTION ENGINE
// Returns confidence 0-100 and flirt type
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
        type:            flirtType
    };
}

// ================================================================
// CONVERSATION SUMMARY
// ================================================================

function summarizeConversation(messages) {
    if (!messages || messages.length === 0)
        return "No conversation to summarize.";

    const speakers = [...new Set(messages.map(m => m.name).filter(Boolean))];
    const counts   = {};
    for (const m of messages) {
        if (m.name) counts[m.name] = (counts[m.name] || 0) + 1;
    }

    const allText = messages.map(m => m.text || "").join(" ").toLowerCase();
    const topics  = [];

    const topicMap = {
        "greeting":  /\b(hello|hi|hey|welcome|good morning)\b/,
        "farewell":  /\b(bye|goodbye|see you|later|ciao)\b/,
        "question":  /\?/,
        "location":  /\b(where|place|sim|region|land)\b/,
        "trading":   /\b(buy|sell|trade|lindens|price|cost)\b/,
        "roleplay":  /\b(roleplay|rp|character|story)\b/,
        "help":      /\b(help|assist|support|problem|how)\b/,
        "romance":   /\b(love|beautiful|kiss|hug|together)\b/
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
// ENDPOINTS
// ================================================================

// TRANSLATE + TRANSLITERATE
app.post("/translate", async (req, res) => {
    const { q, source, target } = req.body;
    if (!q || !target)
        return res.status(400).json({ error: "Missing q or target" });
    try {
        const translated = await translateText(q, source || "auto", target);
        return res.json({ translatedText: formatOutput(translated) });
    } catch(err) {
        console.error("Translation failed:", err.message);
        return res.status(500).json({ error: "Translation failed", details: err.message });
    }
});

// MOOD DETECTION
app.post("/mood", async (req, res) => {
    const { q, source } = req.body;
    if (!q) return res.status(400).json({ error: "Missing q" });

    let text = q;
    try {
        if (source && source !== "en") {
            text = await translateText(q, source || "auto", "en");
        }
    } catch(e) { text = q; }

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

// FLIRT ONLY
app.post("/flirt", async (req, res) => {
    const { q, source } = req.body;
    if (!q) return res.status(400).json({ error: "Missing q" });
    let text = q;
    try {
        if (source && source !== "en") {
            text = await translateText(q, source || "auto", "en");
        }
    } catch(e) { text = q; }
    return res.json(detectFlirt(text));
});

// LANGUAGE DETECTION
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

// CONVERSATION SUMMARY
app.post("/summary", async (req, res) => {
    let { messages } = req.body;
    if (!messages) return res.status(400).json({ error: "Missing messages" });
    if (typeof messages === "string") {
        try { messages = JSON.parse(messages); }
        catch(e) { return res.status(400).json({ error: "Invalid messages JSON" }); }
    }
    return res.json({ summary: summarizeConversation(messages) });
});

// VERSION
app.get("/version", (req, res) => {
    res.json({
        version:  "v2.0",
        product:  "BABEL PRO AI",
        creator:  "Baula16",
        endpoints: ["/translate", "/mood", "/flirt", "/language", "/summary", "/version"]
    });
});

// HEALTH
app.get("/", (req, res) => {
    res.json({
        service: "Everest Translation Pro Server v2.0",
        status:  "online",
        endpoints: ["POST /translate","POST /mood","POST /flirt","POST /language","POST /summary","GET /version"]
    });
});

// START
app.listen(PORT, "0.0.0.0", () => {
    console.log("Everest Translation Pro Server v2.0 running on port " + PORT);
    console.log("LibreTranslate URL: " + LIBRE_URL);
});
