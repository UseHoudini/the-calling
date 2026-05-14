'use strict';

// ─── Dependencies ──────────────────────────────────────────────────────────────
const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

// ─── Config ────────────────────────────────────────────────────────────────────
let config = {};
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
}
const ELEVEN_KEY = process.env.ELEVEN_KEY || config.ELEVEN_KEY || '';
const OPENAI_KEY = process.env.OPENAI_KEY || config.OPENAI_KEY || '';
const PORT       = parseInt(process.env.PORT || config.PORT || '3001', 10);

// ─── In-Memory Store ───────────────────────────────────────────────────────────
// audience: [ { id, token, name, celebrity, magicPref, phone, ttsAudio, ttsReady } ]
const audience = [];
// wsClients: Map<token, WebSocket>
const wsClients = new Map();
// Show state — so reconnecting clients can catch up
// States: 'idle' | 'afterlife' | 'countdown' | 'calling'
let showState = 'idle';
// Stored API keys (set once by performer)
let storedElevenKey = ELEVEN_KEY || '';
let storedOpenaiKey = OPENAI_KEY || '';
// Load persisted keys from disk
try {
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, '.keys.json'), 'utf8'));
  if (saved.elevenKey) storedElevenKey = saved.elevenKey;
  if (saved.openaiKey) storedOpenaiKey = saved.openaiKey;
  console.log('[Keys] Loaded from disk ✓');
} catch(e) {}

// ─── Voice Map (from Dead Ringer) ──────────────────────────────────────────────
const VOICE_MAP = {
  'kobe bryant':       'aVdFG9Q5romKd98dSVdh',
  'kobe':              'aVdFG9Q5romKd98dSVdh',
  'walt disney':       'vYIazACSz4DPLmltsAyn',
  'disney':            'vYIazACSz4DPLmltsAyn',
  'walt':              'vYIazACSz4DPLmltsAyn',
  'princess diana':    'sRFO4G0MKCBQ1a0gGQYe',
  'diana':             'sRFO4G0MKCBQ1a0gGQYe',
  'harry houdini':     'cjVigY5qzO86Huf0OWal',
  'houdini':           'LfMfThLrQdGO1BmE0N8r',
  'whitney houston':   'cRyUlB2zPAr1jqUqw6Fx',
  'whitney':           'cRyUlB2zPAr1jqUqw6Fx',
  'michael jackson':   'urZmM5k1QTgVN2JmfJc7',
  'michael':           'urZmM5k1QTgVN2JmfJc7',
  'steve jobs':        'uHVb7G0k2CPLvDAqoatz',
  'jobs':              'uHVb7G0k2CPLvDAqoatz',
  'jfk':               'GKKwOpPM8kyfq7yd48hk',
  'john f kennedy':    'GKKwOpPM8kyfq7yd48hk',
  'kennedy':           'GKKwOpPM8kyfq7yd48hk',
  'abraham lincoln':   '3vw3hkh8vIjAQzjwpcDI',
  'abe lincoln':       '3vw3hkh8vIjAQzjwpcDI',
  'lincoln':           '3vw3hkh8vIjAQzjwpcDI',
  'abe':               '3vw3hkh8vIjAQzjwpcDI',
  'juice wrld':        '3rl7ZNEnM2UglHRA2rx3',
  'juice world':       '3rl7ZNEnM2UglHRA2rx3',
  'juice':             '3rl7ZNEnM2UglHRA2rx3',
  'heath ledger':      'V7uCgby056wvfmvamrnV',
  'heath':             'V7uCgby056wvfmvamrnV',
  'john lennon':       '4jT7TTfvFfsPCz4vqduc',
  'lennon':            '4jT7TTfvFfsPCz4vqduc',
  'bob marley':        '9kxVQCr60FB5o5vKvKak',
  'marley':            '9kxVQCr60FB5o5vKvKak',
  'marilyn monroe':    'WbPzaoyMVBCkXAbE6Vfi',
  'marilyn':           'WbPzaoyMVBCkXAbE6Vfi',
  'chuck norris':      'xn9KWgv3xR7smmkrXpW8',
  'chuck':             'xn9KWgv3xR7smmkrXpW8',
  "catherine o'hara":  'LFd2FfkOWJKHFMvQOtam',
  'catherine ohara':   'LFd2FfkOWJKHFMvQOtam',
  'ohara':             'LFd2FfkOWJKHFMvQOtam',
  'matthew perry':     '9w8gJWCDurewbcz8vWGk',
  'perry':             '9w8gJWCDurewbcz8vWGk',
  'matthew':           '9w8gJWCDurewbcz8vWGk',
  'elvis presley':     'f0hvuvk7orYaOyC5jqAZ',
  'elvis':             'f0hvuvk7orYaOyC5jqAZ',
  'prince':            'EDqHs1omdkUctOCK0PYx',
  'prints':            'EDqHs1omdkUctOCK0PYx',
  'bill russell':      'N8LUcBTezvjjZFlOkiig',
  'russell':           'N8LUcBTezvjjZFlOkiig',
  'tupac shakur':      'g2srkPH2JLJ6SWqLZvJV',
  'tupac':             'g2srkPH2JLJ6SWqLZvJV',
  'frank sinatra':     'UApOywyfIRWL1eYAGqkT',
  'sinatra':           'UApOywyfIRWL1eYAGqkT',
  'frank':             'UApOywyfIRWL1eYAGqkT',
  'robin williams':    'L01ENCzToy2jVaLZg5TH',
  'amy winehouse':     '8VWVCGwBwfNSnbvxN4mF',
  'amy':               '8VWVCGwBwfNSnbvxN4mF',
  'jesus':             'iP95p4xoKVk53GoZ742B',
  'jesus christ':      'iP95p4xoKVk53GoZ742B',
  'james earl jones':  'bKWI3NYJVPOoSMXAxl2U',
  'jones':             'bKWI3NYJVPOoSMXAxl2U',
  'george michael':    'Vwo3n6phOshEngGhRGDv',
  'chris farley':      'ypY8WyMPuH3e0qFlPkz8',
  'farley':            'ypY8WyMPuH3e0qFlPkz8',
  'george washington': 'pqHfZKP75CvOlQylNhV4',
  'washington':        'pqHfZKP75CvOlQylNhV4',
  'thomas jefferson':  'N2lVS1w4EtoT3dr4eOWO',
  'jefferson':         'N2lVS1w4EtoT3dr4eOWO',
  'benjamin franklin': '1sl7XMHkUEezwYy9NbJU',
  'ben franklin':      '1sl7XMHkUEezwYy9NbJU',
  'franklin':          '1sl7XMHkUEezwYy9NbJU',
  'cleopatra':           'pFZP5JQG7iQjIQuC4Bku',
  'alexander the great': 'Gf2vlf3D7zk4ydlo3ULy',
  'alexander':         'Gf2vlf3D7zk4ydlo3ULy',
  'julius caesar':     'nPczCjzI2devNBz1zQrb',
  'caesar':            'nPczCjzI2devNBz1zQrb',
  'sean connery':      'ZQe5CZNOzWyzPSCn5a3c',
  'connery':           'ZQe5CZNOzWyzPSCn5a3c',
  'elizabeth taylor':  'MftN0gvsFPPOYnV3DU0Y',
  'taylor':            'MftN0gvsFPPOYnV3DU0Y',
  'margaret thatcher': 'AFK8xDg9oUObwWPVyhfR',
  'thatcher':          'AFK8xDg9oUObwWPVyhfR',
  'nelson mandela':    'ec0Fx65Vil8JBr4VRwe6',
  'mandela':           'ec0Fx65Vil8JBr4VRwe6',
  'paul newman':       'D8nm77idSjZDgbKZ8vFL',
  'newman':            'D8nm77idSjZDgbKZ8vFL',
  'ronald reagan':     'j1OTdQJ24wlJmhqUkMOr',
  'reagan':            'j1OTdQJ24wlJmhqUkMOr',
  'robert redford':    'lrr1uPW80AOljsuo3i3t',
  'redford':           'lrr1uPW80AOljsuo3i3t',
  'john wayne':        '5nPMfNN64QLeJ30Vgrub',
  'wayne':             '5nPMfNN64QLeJ30Vgrub',
  'jim morrison':      'FWCNEHwbQhB1Da2r1GKI',
  'morrison':          'FWCNEHwbQhB1Da2r1GKI',
  'jim':               'FWCNEHwbQhB1Da2r1GKI',
  'nikola tesla':      'Xh5OictnmgRO4dff7pLm',
  'tesla':             'Xh5OictnmgRO4dff7pLm',
  'nikolai tesla':     'Xh5OictnmgRO4dff7pLm',
};

function findVoiceId(name) {
  if (!name) return null;
  const low = name.toLowerCase().trim();
  if (VOICE_MAP[low]) return VOICE_MAP[low];
  // Longest key substring match
  let bestKey = null, bestLen = 0;
  for (const key of Object.keys(VOICE_MAP)) {
    if ((low.includes(key) || key.includes(low)) && key.length > bestLen) {
      bestLen = key.length;
      bestKey = key;
    }
  }
  return bestKey ? VOICE_MAP[bestKey] : null;
}

// ─── TTS Generation ────────────────────────────────────────────────────────────
async function buildTTSScript(member, openaiKey) {
  const firstName = member.name.split(/\s+/)[0];
  const cel = member.celebrity;

  // Use GPT to generate a natural, warm, personal message
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 80,
          messages: [
            { role: 'system', content: `You are ${cel} calling ${firstName} from beyond. Write a short, warm, deeply personal spoken message — 2-3 sentences max. Start by saying the person's name then who you are. End with one genuine, positive, emotional message. Speak naturally as ${cel} would. No quotation marks. No stage directions. Just the words to be spoken.` },
            { role: 'user', content: `Write ${cel}'s message to ${firstName}.` }
          ]
        })
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch(e) {}
  }

  // Fallback if no GPT key
  return `${firstName}… it's ${cel}. I'm so proud of you. Don't ever forget that.`;
}

async function translateScript(text, language, openaiKey) {
  if (!openaiKey || !language || language.startsWith('en')) return text;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          { role: 'system', content: `Translate the following text into the language with locale code "${language}". Return only the translated text, nothing else. Preserve names as-is.` },
          { role: 'user', content: text }
        ]
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  } catch(e) { return text; }
}

async function generateTTS(member, elevenKey, openaiKey) {
  let text = await buildTTSScript(member, openaiKey);
  console.log(`[Script] ${member.name}: "${text}"`);
  if (member.language && !member.language.startsWith('en')) {
    text = await translateScript(text, member.language, openaiKey);
    console.log(`[TTS] Translated to ${member.language}: ${text}`);
  }
  const voiceId = findVoiceId(member.celebrity);

  // Try ElevenLabs first if we have a voice ID and key
  if (voiceId && elevenKey) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenKey,
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { audio: buf.toString('base64'), mime: 'audio/mpeg', source: 'elevenlabs' };
      }
      console.warn(`[TTS] ElevenLabs failed for ${member.name}: ${res.status}`);
    } catch (err) {
      console.warn(`[TTS] ElevenLabs error for ${member.name}:`, err.message);
    }
  }

  // Fall back to OpenAI TTS
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: 'onyx',
        }),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { audio: buf.toString('base64'), mime: 'audio/mpeg', source: 'openai' };
      }
      console.warn(`[TTS] OpenAI failed for ${member.name}: ${res.status}`);
    } catch (err) {
      console.warn(`[TTS] OpenAI error for ${member.name}:`, err.message);
    }
  }

  return null;
}

// ─── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of wsClients.values()) {
    if (ws.readyState === 1 /* OPEN */) ws.send(msg);
  }
}

function broadcastStats() {
  const prefs = {};
  for (const m of audience) if (m.magicPref) prefs[m.magicPref] = (prefs[m.magicPref] || 0) + 1;
  const names = audience.map(m => m.name.split(/\s+/)[0]);
  broadcast({ type: 'stats', audienceCount: audience.length, prefs, names });
}

// ─── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
// No-cache for audience.html — prevents stale versions getting stuck in browser cache
// Serve Dead Ringer web app at /dr — no-cache so updates show immediately
app.get('/dr', (req, res) => res.redirect('/dr/index.html'));
app.get('/dr/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, '../dead-ringer/app/index.html'));
});
app.use('/dr', express.static(path.join(__dirname, '../dead-ringer/app'), { etag: false, maxAge: 0 }));

app.get('/audience.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// POST /survey
app.post('/survey', (req, res) => {
  const { name, celebrity, magicPref, region, language } = req.body;
  if (!name || !celebrity || !magicPref) {
    return res.status(400).json({ error: 'name, celebrity, and magicPref are required' });
  }
  const id    = crypto.randomUUID();
  const token = crypto.randomBytes(16).toString('hex');
  const member = { id, token, name: name.trim(), celebrity: celebrity.trim(), magicPref, region: region || null, city: null, language: language || 'en', ttsAudio: null, ttsReady: false };

  // IP geolocation — get real city
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  fetch(`https://ipapi.co/${ip}/json/`)
    .then(r => r.json())
    .then(geo => {
      if (geo.city) { member.city = geo.city; console.log(`[Geo] ${member.name} → ${geo.city}, ${geo.region}`); }
    })
    .catch(() => {});
  audience.push(member);
  console.log(`[Survey] ${member.name} → ${member.celebrity} (${member.magicPref}) | device: ${member.device} | screen: ${req.body._screenDebug || 'unknown'}`);
  // Auto-generate TTS immediately if keys are stored
  if (storedElevenKey || storedOpenaiKey) {
    generateTTS(member, storedElevenKey, storedOpenaiKey)
      .then(result => {
        member.ttsAudio = result.audio;
        member.ttsMime  = result.mime;
        member.ttsReady = true;
        console.log(`[AutoTTS] ✓ ${member.name} (${member.celebrity})`);
        broadcastStats();
      })
      .catch(err => console.error(`[AutoTTS] ✗ ${member.name}:`, err.message));
  }
  broadcastStats();
  res.json({ id, token });
});

// GET /status
app.get('/', (req, res) => res.redirect('/audience.html'));

// POST /save-keys — store API keys for auto-TTS
const KEYS_FILE = path.join(__dirname, '.keys.json');
// Load keys from disk on startup
try {
  const saved = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  if (saved.elevenKey) storedElevenKey = saved.elevenKey;
  if (saved.openaiKey) storedOpenaiKey = saved.openaiKey;
  console.log('[Keys] Loaded from disk ✓');
} catch(e) {}

app.post('/save-keys', (req, res) => {
  if (req.body.elevenKey) storedElevenKey = req.body.elevenKey;
  if (req.body.openaiKey) storedOpenaiKey = req.body.openaiKey;
  // Persist to disk so keys survive server restarts
  try { fs.writeFileSync(KEYS_FILE, JSON.stringify({ elevenKey: storedElevenKey, openaiKey: storedOpenaiKey }), { mode: 0o600 }); } catch(e) {}
  res.json({ saved: true });
});

// POST /show-afterlife — switch all audience screens to Afterlife Network
app.post('/show-afterlife', (req, res) => {
  showState = 'afterlife';
  broadcast({ type: 'show-afterlife' });
  console.log(`[Afterlife] Sent to ${wsClients.size} connected clients`);
  res.json({ sent: true, count: wsClients.size });
});

// POST /start-countdown — broadcast 3-2-1 then fire mass call
app.post('/start-countdown', (req, res) => {
  showState = 'countdown';
  const count = wsClients.size;
  res.json({ started: true, audienceCount: count });
  // Broadcast countdown to all clients
  broadcast({ type: 'countdown', seconds: 3 });
  // After 3 seconds, fire the mass call
  setTimeout(() => {
    showState = 'calling';
    for (const member of audience) {
      const ws = wsClients.get(member.token);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'incoming-call',
          celebrity: member.celebrity,
          audienceName: member.name,
          ttsAudio: member.ttsAudio || null,
          ttsMime: member.ttsMime || 'audio/mpeg',
        }));
      }
    }
    console.log(`[Countdown] ✓ Calls fired to ${wsClients.size} connected clients`);
  }, 3500); // slight buffer after "1"
});

app.get('/status', (req, res) => {
  const ttsTotal   = audience.length;
  const ttsReady   = audience.filter(m => m.ttsReady).length;
  const ttsPercent = ttsTotal > 0 ? Math.round((ttsReady / ttsTotal) * 100) : 0;
  const audienceList = audience.map(m => ({
    id: m.id,
    name: m.name,
    celebrity: m.celebrity,
    magicPref: m.magicPref,
    ttsReady: m.ttsReady,
  }));
  res.json({ audienceCount: ttsTotal, connectedCount: wsClients.size, ttsReady, ttsTotal, ttsPercent, audienceList });
});

// POST /generate-tts
let ttsInProgress = false;
app.post('/generate-tts', async (req, res) => {
  // Read keys from request body (performer may pass them) or fall back to config
  const elevenKey = req.body?.elevenKey || ELEVEN_KEY;
  const openaiKey = req.body?.openaiKey || OPENAI_KEY;

  if (ttsInProgress) return res.status(409).json({ error: 'TTS generation already in progress' });
  if (!elevenKey && !openaiKey) return res.status(400).json({ error: 'No API keys configured' });

  ttsInProgress = true;
  res.json({ started: true, total: audience.length });

  // Process in background, sequentially (rate limit friendly)
  (async () => {
    for (const member of audience) {
      if (member.ttsReady) continue; // skip already generated
      try {
        const result = await generateTTS(member, elevenKey, openaiKey);
        if (result) {
          member.ttsAudio = result.audio;
          member.ttsMime  = result.mime;
          member.ttsReady = true;
          console.log(`[TTS] ✓ ${member.name} (${result.source})`);
        } else {
          console.warn(`[TTS] ✗ No audio for ${member.name}`);
        }
      } catch (err) {
        console.error(`[TTS] Error for ${member.name}:`, err.message);
      }
      // Small delay between API calls to be polite to rate limits
      await new Promise(r => setTimeout(r, 300));
    }
    ttsInProgress = false;
    console.log(`[TTS] Complete: ${audience.filter(m => m.ttsReady).length}/${audience.length} ready`);
  })();
});

// POST /trigger-mass-call
app.post('/trigger-mass-call', (req, res) => {
  const delay = parseInt(req.body?.delay || '0', 10);
  const count = wsClients.size;
  console.log(`[MassCall] Triggering for ${audience.length} audience members (delay: ${delay}ms)`);
  res.json({ triggered: true, audienceCount: count });

  setTimeout(() => {
    for (const member of audience) {
      const ws = wsClients.get(member.token);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'incoming-call',
          celebrity: member.celebrity,
          audienceName: member.name,
          ttsAudio: member.ttsAudio || null,
          ttsMime: member.ttsMime || 'audio/mpeg',
        }));
      }
    }
    console.log(`[MassCall] ✓ Sent to ${wsClients.size} connected clients`);
  }, delay);
});

// POST /reset (utility for performer to clear audience between shows)
app.post('/reset', (req, res) => {
  const count = audience.length;
  audience.length = 0;
  showState = 'idle';
  wsClients.clear();
  ttsInProgress = false;
  res.json({ cleared: count });
  console.log(`[Reset] Cleared ${count} audience members`);
});

// ─── TwiML Endpoints (for Twilio calls) ────────────────────────────────────────
// GET /twiml/mothers-day — Returns TwiML XML to play Frank Sinatra audio
app.get('/twiml/mothers-day', (req, res) => {
  // Dynamically construct audio URL from request host (works via ngrok, Cloudflare tunnel, or localhost)
  const host = req.get('host');
  const audioUrl = `https://${host}/frank_mothers_day.mp3`; // Use HTTPS for ngrok compatibility
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`;
  
  res.type('application/xml').send(twiml);
  console.log(`[TwiML] Served mothers-day call script (audio: ${audioUrl})`);
});

// GET /twiml/john-wayne-hello — Returns TwiML XML to play John Wayne hello
app.get('/twiml/john-wayne-hello', (req, res) => {
  const host = req.get('host');
  const audioUrl = `https://${host}/john_wayne_hello.mp3`; // Use HTTPS for ngrok compatibility
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`;
  
  res.type('application/xml').send(twiml);
  console.log(`[TwiML] Served John Wayne hello (audio: ${audioUrl})`);
});

// GET /twiml/john-wayne-funny — Returns TwiML XML to play John Wayne funny message
app.get('/twiml/john-wayne-funny', (req, res) => {
  const host = req.get('host');
  const audioUrl = `https://${host}/john_wayne_funny.mp3`;
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`;
  
  res.type('application/xml').send(twiml);
  console.log(`[TwiML] Served John Wayne funny (audio: ${audioUrl})`);
});

// GET /twiml/mothers-day-voicemail — For leaving message on voicemail
app.get('/twiml/mothers-day-voicemail', (req, res) => {
  // Dynamically construct audio URL from request host (works via ngrok, Cloudflare tunnel, or localhost)
  const host = req.get('host');
  const audioUrl = `https://${host}/frank_mothers_day.mp3`; // Use HTTPS for ngrok compatibility
  
  // Wait 3 seconds for voicemail beep, then play the message
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="3"/>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`;
  
  res.type('application/xml').send(twiml);
  console.log(`[TwiML] Served mothers-day voicemail script (audio: ${audioUrl})`);
});

// ─── HTTP + WebSocket Server ───────────────────────────────────────────────────
// Note: Railway handles HTTPS at the edge; app listens on HTTP
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  let token = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth' && msg.token) {
        token = msg.token;
        const member = audience.find(m => m.token === token);
        if (member) {
          wsClients.set(token, ws);
          console.log(`[WS] ${member.name} connected`);
          // Send current stats immediately on connect
          const prefs = {};
          for (const m of audience) if (m.magicPref) prefs[m.magicPref] = (prefs[m.magicPref] || 0) + 1;
          const names = audience.map(m => m.name.split(/\s+/)[0]);
          ws.send(JSON.stringify({ type: 'stats', audienceCount: audience.length, prefs, names }));
          ws.send(JSON.stringify({ type: 'auth-ok', name: member.name, showState }));
          // Catch-up: send current show state so reconnecting clients jump to right screen
          if (showState === 'afterlife') {
            ws.send(JSON.stringify({ type: 'show-afterlife', catchUp: true }));
          } else if (showState === 'calling') {
            // Re-send their personal incoming call
            if (member.ttsAudio) {
              ws.send(JSON.stringify({
                type: 'incoming-call',
                celebrity: member.celebrity,
                audienceName: member.name,
                ttsAudio: member.ttsAudio,
                ttsMime: member.ttsMime || 'audio/mpeg',
              }));
            }
          }
        } else {
          ws.send(JSON.stringify({ type: 'auth-fail', error: 'Invalid token' }));
        }
      }
    } catch (e) {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (token) {
      wsClients.delete(token);
      const member = audience.find(m => m.token === token);
      if (member) console.log(`[WS] ${member.name} disconnected`);
    }
  });

  ws.on('error', (err) => {
    console.warn('[WS] Error:', err.message);
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎩 The Calling server running on http://localhost:${PORT} (Railway handles HTTPS at edge)`);
  console.log(`   Audience: http://localhost:${PORT}/audience.html`);
  console.log(`   Performer: http://localhost:${PORT}/performer.html`);
  console.log(`   ElevenLabs key: ${storedElevenKey ? '✓ configured' : '✗ not set (use performer config)'}`);
  console.log(`   OpenAI key: ${storedOpenaiKey ? '✓ configured' : '✗ not set (use performer config)'}\n`);
});

server.on('error', (err) => {
  console.error('[Server] Fatal error:', err.message);
  process.exit(1);
});
