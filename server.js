// ================================================================
// BABEL PRO AI -- Language Services Server v2.1
// By Baula16
// ================================================================
// 12 FREE TRANSLATION API FALLBACKS -- zero cost, always online:
//   1.  MyMemory (anon)      free, no key, 1000/day
//   2.  MyMemory (email)     free, no key, 10000/day
//   3.  Lingva instance 1    free, no key, no limit
//   4.  Lingva instance 2    free, no key, no limit
//   5.  Lingva instance 3    free, no key, no limit
//   6.  Lingva instance 4    free, no key, no limit
//   7.  LibreTranslate pub 1 free community server
//   8.  LibreTranslate pub 2 free community server
//   9.  LibreTranslate pub 3 free community server
//  10.  LibreTranslate pub 4 free community server
//  11.  Apertium             free open source, very stable
//  12.  Your Railway LT      self-hosted last resort
// ================================================================

const express = require("express");
const axios   = require("axios");
const { transliterate } = require("transliteration");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================================================================
// API URLS
// ================================================================
const MYMEMORY_URL   = "https://api.mymemory.translated.net/get";
const MYMEMORY_EMAIL = "babel.pro.ai.translate@gmail.com";

const LINGVA = [
    "https://lingva.thedaviddelta.com/api/v1",
    "https://lingva.lunar.icu/api/v1",
    "https://translate.jae.fi/api/v1",
    "https://lingva.garudalinux.org/api/v1"
];

const LIBRETRANSLATE = [
    "https://translate.terraprint.co/translate",
    "https://lt.vern.cc/translate",
    "https://translate.flossboxin.org.in/translate",
    "https://translate.argosopentech.com/translate"
];

const APERTIUM_URL = "https://www.apertium.org/apy/translate";
const LIBRE_OWN    = process.env.LIBRE_URL || "https://libretranslate-production-b4f1.up.railway.app/translate";

// ================================================================
// LANGUAGE NORMALIZATION
// ================================================================
function normLang(code) {
    if (!code || code === "auto") return "en";
    const map = { "zh": "zh", "zh-cn": "zh", "zh-tw": "zh", "pt": "pt", "pt-br": "pt", "no": "nb" };
    return map[code.toLowerCase()] || code.toLowerCase();
}

// ================================================================
// TRANSLITERATION -- converts Russian/Japanese/Arabic etc to phonetic
// ================================================================
function isNonLatin(text) {
    return /[\u0400-\u04FF]/.test(text) || /[\u4E00-\u9FFF]/.test(text) ||
           /[\u3040-\u309F]/.test(text) || /[\u30A0-\u30FF]/.test(text) ||
           /[\uAC00-\uD7AF]/.test(text) || /[\u0600-\u06FF]/.test(text) ||
           /[\u0900-\u097F]/.test(text) || /[\u0E00-\u0E7F]/.test(text) ||
           /[\u0590-\u05FF]/.test(text) || /[\u0370-\u03FF]/.test(text);
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
// API STATUS TRACKING -- skips failed APIs for 5 minutes
// ================================================================
const apiStatus = {};
const COOLDOWN  = 300000; // 5 minutes

function markFailed(key) {
    apiStatus[key] = { failed: true, until: Date.now() + COOLDOWN };
}
function markOK(key) {
    apiStatus[key] = { failed: false, until: 0 };
}
function skip(key) {
    const s = apiStatus[key];
    if (!s || !s.failed) return false;
    if (Date.now() > s.until) { apiStatus[key].failed = false; return false; }
    return true;
}

// ================================================================
// MASTER TRANSLATE FUNCTION -- 12 API waterfall
// ================================================================
async function translateText(q, source, target) {
    if (!q || q.trim() === "") return q;
    const src = normLang(source);
    const tgt = normLang(target);

    // 1 -- MyMemory anonymous
    if (!skip("mm1")) {
        try {
            const r = await axios.get(MYMEMORY_URL + "?q=" + encodeURIComponent(q)
                + "&langpair=" + encodeURIComponent(src + "|" + tgt), { timeout: 7000 });
            if (r.data?.responseStatus === 200 && r.data?.responseData?.translatedText &&
                r.data.responseData.translatedText !== q) {
                markOK("mm1");
                return r.data.responseData.translatedText;
            }
        } catch(e) { if (e.response?.status === 429) markFailed("mm1"); }
    }

    // 2 -- MyMemory with email (10x limit)
    if (!skip("mm2")) {
        try {
            const r = await axios.get(MYMEMORY_URL + "?q=" + encodeURIComponent(q)
                + "&langpair=" + encodeURIComponent(src + "|" + tgt)
                + "&de=" + MYMEMORY_EMAIL, { timeout: 7000 });
            if (r.data?.responseStatus === 200 && r.data?.responseData?.translatedText &&
                r.data.responseData.translatedText !== q) {
                markOK("mm2");
                return r.data.responseData.translatedText;
            }
        } catch(e) { if (e.response?.status === 429) markFailed("mm2"); }
    }

    // 3-6 -- Lingva instances
    for (let i = 0; i < LINGVA.length; i++) {
        if (skip("lg" + i)) continue;
        try {
            const r = await axios.get(LINGVA[i] + "/" + src + "/" + tgt + "/" + encodeURIComponent(q),
                { timeout: 5000 });
            if (r.data?.translation && r.data.translation.trim()) {
                markOK("lg" + i);
                return r.data.translation;
            }
        } catch(e) { markFailed("lg" + i); }
    }

    // 7-10 -- LibreTranslate public instances
    for (let i = 0; i < LIBRETRANSLATE.length; i++) {
        if (skip("lt" + i)) continue;
        try {
            const r = await axios.post(LIBRETRANSLATE[i],
                { q, source: src, target: tgt, format: "text", api_key: "" },
                { headers: { "Content-Type": "application/json" }, timeout: 6000 });
            if (r.data?.translatedText && r.data.translatedText.trim()) {
                markOK("lt" + i);
                return r.data.translatedText;
            }
        } catch(e) { markFailed("lt" + i); }
    }

    // 11 -- Apertium (rule-based, very stable uptime)
    if (!skip("ap")) {
        try {
            const r = await axios.get(APERTIUM_URL,
                { params: { q, langpair: src + "|" + tgt, markUnknown: "no" }, timeout: 6000 });
            if (r.data?.responseData?.translatedText) {
                markOK("ap");
                return r.data.responseData.translatedText;
            }
        } catch(e) { markFailed("ap"); }
    }

    // 12 -- Your own Railway LibreTranslate
    if (!skip("lo")) {
        try {
            const r = await axios.post(LIBRE_OWN,
                { q, source: src, target: tgt, format: "text", api_key: "" },
                { headers: { "Content-Type": "application/json" }, timeout: 12000 });
            if (r.data?.translatedText && r.data.translatedText.trim()) {
                markOK("lo");
                return r.data.translatedText;
            }
        } catch(e) { markFailed("lo"); }
    }

    // All 12 failed -- return original so HUD never crashes
    console.error("[FAIL] All 12 APIs failed for: " + q.substring(0, 40));
    return q;
}

// ================================================================
// MOOD DETECTION
// ================================================================
const MOOD_PATTERNS = {
    flirting: [/\b(beautiful|gorgeous|sexy|cute|handsome|pretty|hot|attractive|stunning)\b/i,
               /\b(wink|kiss|hug|cuddle|snuggle|caress|touch)\b/i,
               /\b(like you|love you|adore you|fancy you|want you)\b/i,
               /[;]\)|:\*|<3/, /\b(flirt|tease|seduce|charm|tempt)\b/i],
    angry:    [/\b(hate|angry|furious|mad|rage|annoyed|irritated)\b/i,
               /\b(stupid|idiot|fool|moron|dumb|shut up|get lost)\b/i, /[!]{3,}/],
    sad:      [/\b(sad|cry|tears|lonely|alone|miss|hurt|pain|sorry)\b/i,
               /\b(depressed|unhappy|upset|devastated|heartbroken)\b/i],
    excited:  [/\b(amazing|awesome|fantastic|incredible|wow|omg|yay)\b/i,
               /\b(cant wait|so excited|thrilled|pumped|stoked|hyped)\b/i],
    happy:    [/\b(happy|great|good|wonderful|nice|enjoy|fun|glad)\b/i,
               /\b(thank|thanks|grateful|appreciate|blessed|lucky)\b/i,
               /\b(haha|lol|hehe|lmao|rofl)\b/i],
    nervous:  [/\b(nervous|anxious|worried|scared|afraid|fear|stress)\b/i,
               /\b(not sure|maybe|perhaps|i think|i hope|what if)\b/i,
               /\b(um|uh|err|hmm|well|i guess|sort of)\b/i]
};

function detectMood(text) {
    const scores = { flirting:0, angry:0, sad:0, excited:0, happy:0, nervous:0 };
    for (const [mood, patterns] of Object.entries(MOOD_PATTERNS)) {
        for (const p of patterns) { const m = text.match(p); if(m) scores[mood]+=m.length; }
    }
    let topMood = "neutral", topScore = 0;
    for (const [mood, score] of Object.entries(scores)) {
        if (score > topScore) { topScore = score; topMood = mood; }
    }
    const moodMap = {
        flirting: { emoji:"~", label:"FLIRTING", alert:true  },
        angry:    { emoji:"!", label:"ANGRY",    alert:true  },
        sad:      { emoji:".", label:"SAD",      alert:false },
        excited:  { emoji:"*", label:"EXCITED",  alert:false },
        happy:    { emoji:"+", label:"HAPPY",    alert:false },
        nervous:  { emoji:"?", label:"NERVOUS",  alert:false },
        neutral:  { emoji:"-", label:"NEUTRAL",  alert:false }
    };
    return { mood: topMood, score: topScore, ...moodMap[topMood] };
}

// ================================================================
// FLIRT DETECTION
// ================================================================
function detectFlirt(text) {
    let score = 0, flirtType = "none";
    const checks = [
        { p: /\b(beautiful|gorgeous|pretty|cute|hot|sexy|stunning)\b/i, pts: 30, t: "compliment" },
        { p: /\b(like you|love you|adore you|want you|desire)\b/i,      pts: 40, t: "emotional"  },
        { p: /\b(kiss|hug|cuddle|touch|hold me|hold you)\b/i,           pts: 35, t: "physical"   },
        { p: /[;]\)|:\*|<3/,                                             pts: 25, t: "emoji"      },
        { p: /\b(date|together|meet me|come over|spend time)\b/i,       pts: 30, t: "invitation" },
        { p: /\b(wink|tease|flirt|seduce)\b/i,                          pts: 40, t: "direct"     },
        { p: /\b(mine|yours|just us|we could|you and me)\b/i,           pts: 20, t: "possessive" }
    ];
    for (const c of checks) { if (c.p.test(text)) { score += c.pts; flirtType = c.t; } }
    return { isFlirting: score>=30, confidence: Math.min(score,100),
             flirtConfidence: Math.min(score,100), flirtType, type: flirtType };
}

// ================================================================
// CONVERSATION SUMMARY
// ================================================================
function summarizeConversation(messages) {
    if (!messages || messages.length === 0) return "No conversation to summarize.";
    const speakers = [...new Set(messages.map(m => m.name).filter(Boolean))];
    const counts   = {};
    for (const m of messages) { if(m.name) counts[m.name]=(counts[m.name]||0)+1; }
    const allText = messages.map(m => m.text || "").join(" ").toLowerCase();
    const topics  = [];
    const topicMap = {
        "greeting":  /\b(hello|hi|hey|welcome)\b/,
        "farewell":  /\b(bye|goodbye|see you|later)\b/,
        "question":  /\?/,
        "location":  /\b(where|place|sim|region)\b/,
        "trading":   /\b(buy|sell|trade|lindens|price)\b/,
        "roleplay":  /\b(roleplay|rp|character|story)\b/,
        "romance":   /\b(love|beautiful|kiss|hug|together)\b/
    };
    for (const [topic, pattern] of Object.entries(topicMap)) {
        if (pattern.test(allText)) topics.push(topic);
    }
    return [messages.length + " messages",
            "speakers: " + (speakers.slice(0,3).join(", ")||"unknown"),
            "topics: " + (topics.join(", ")||"general"),
            Object.entries(counts).map(([n,c])=>n+":"+c).join(" ")].join(" | ");
}

// ================================================================
// RATE LIMITING
// ================================================================
const rateMap = {};
app.use((req, res, next) => {
    const ip  = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    if (!rateMap[ip]) rateMap[ip] = { count:0, reset: now+60000 };
    if (now > rateMap[ip].reset) rateMap[ip] = { count:0, reset: now+60000 };
    if (++rateMap[ip].count > 120) return res.status(429).json({ error:"Too many requests" });
    const q = req.body?.q || "";
    if (q.length > 2000) return res.status(400).json({ error:"Text too long" });
    next();
});
setInterval(() => {
    const now = Date.now();
    for (const ip of Object.keys(rateMap)) { if(now>rateMap[ip].reset) delete rateMap[ip]; }
}, 300000);

// ================================================================
// ROUTES
// ================================================================
app.post("/translate", async (req, res) => {
    const { q, source, target } = req.body;
    if (!q || !target) return res.status(400).json({ error:"Missing q or target" });
    try {
        const translated = await translateText(q, source||"auto", target);
        return res.json({ translatedText: formatOutput(translated) });
    } catch(e) { return res.json({ translatedText: q }); }
});

app.post("/mood", async (req, res) => {
    const { q, source } = req.body;
    if (!q) return res.status(400).json({ error:"Missing q" });
    let text = q;
    if (source && source !== "en" && source !== "auto")
        text = await translateText(q, source, "en");
    const mood = detectMood(text); const flirt = detectFlirt(text);
    return res.json({ mood:mood.label, moodEmoji:mood.emoji, alert:mood.alert,
        isFlirting:flirt.isFlirting, flirtConfidence:flirt.confidence, flirtType:flirt.type });
});

app.post("/flirt", async (req, res) => {
    const { q, source } = req.body;
    if (!q) return res.status(400).json({ error:"Missing q" });
    let text = q;
    if (source && source !== "en" && source !== "auto")
        text = await translateText(q, source, "en");
    return res.json(detectFlirt(text));
});

app.post("/language", async (req, res) => {
    const { q } = req.body;
    if (!q) return res.status(400).json({ error:"Missing q" });
    try {
        const r = await axios.post(LIBRE_OWN.replace("/translate","/detect"), { q },
            { headers:{"Content-Type":"application/json"}, timeout:5000 });
        if (r.data?.length > 0) return res.json({ language:r.data[0].language, confidence:Math.round(r.data[0].confidence*100) });
    } catch(e) {}
    return res.json({ language:"unknown", confidence:0 });
});

app.post("/summary", async (req, res) => {
    let { messages } = req.body;
    if (!messages) return res.status(400).json({ error:"Missing messages" });
    if (typeof messages === "string") { try { messages=JSON.parse(messages); } catch(e) { return res.status(400).json({ error:"Invalid JSON" }); } }
    return res.json({ summary: summarizeConversation(messages) });
});

app.get("/version", (req, res) => {
    res.json({ version:"v2.1", product:"BABEL PRO AI", creator:"Baula16",
        endpoints:["/translate","/mood","/flirt","/language","/summary","/version","/health"] });
});

app.get("/health", (req, res) => {
    const now = Date.now();
    const apis = {};
    ["mm1","mm2","lg0","lg1","lg2","lg3","lt0","lt1","lt2","lt3","ap","lo"].forEach(k => {
        const s = apiStatus[k];
        if (!s) apis[k]="untested";
        else if (!s.failed) apis[k]="ok";
        else if (now > s.until) apis[k]="recovering";
        else apis[k]="cooldown_"+Math.round((s.until-now)/1000)+"s";
    });
    res.json({ service:"BABEL PRO AI v2.1", status:"online", totalApis:12, apis });
});

app.get("/", (req, res) => {
    res.json({ service:"BABEL PRO AI Language Services v2.1", status:"online", creator:"Baula16",
        apis:"12 free fallbacks -- always online" });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("BABEL PRO AI Language Services v2.1 running on port " + PORT);
    console.log("APIs: MyMemory(x2) Lingva(x4) LibreTranslate(x4) Apertium Self-hosted = 12 total");
    console.log("Zero cost -- all free APIs -- LibreTranslate only used as last resort");
});
