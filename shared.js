'use strict';
// Shared by the Express API (server.js) and the Expo app (App.js).
// One source of truth => the prompt the user previews is the prompt that is generated.

const STYLES = ['Anime Film', 'Dark Fantasy', 'Dreamscape', 'Cyberpunk', 'Cinematic', '3D Cartoon'];

const CAMERAS = [
  { id: 'auto', label: 'Auto', text: '' },
  { id: 'orbit', label: 'Orbit', text: 'slow cinematic orbit around the subject' },
  { id: 'dolly', label: 'Dolly in', text: 'smooth dolly-in toward the subject' },
  { id: 'tracking', label: 'Tracking', text: 'steady tracking shot following the subject' },
  { id: 'crane', label: 'Crane up', text: 'rising crane shot revealing the full scene' },
  { id: 'handheld', label: 'Handheld', text: 'subtle handheld camera, documentary realism' },
];

const MOODS = [
  { id: 'auto', label: 'Auto', text: '' },
  { id: 'epic', label: 'Epic', text: 'epic, awe-inspiring atmosphere, dramatic volumetric light' },
  { id: 'dreamy', label: 'Dreamy', text: 'soft, dreamy glow, floating particles, pastel haze' },
  { id: 'tense', label: 'Tense', text: 'tense, moody shadows, high contrast, slow suspense' },
  { id: 'joyful', label: 'Joyful', text: 'warm, joyful, golden-hour sunlight, lively motion' },
  { id: 'neon', label: 'Neon', text: 'saturated neon glow, reflective surfaces, night atmosphere' },
];

const AD_TEMPLATES = [
  { id: 'hero', label: 'Product Hero', text: 'Premium product hero shot, slow rotating reveal, studio lighting, clean background' },
  { id: 'reel', label: 'Social Reel', text: 'Fast, punchy social media reel, dynamic cuts, vibrant colors, thumb-stopping opening' },
  { id: 'story', label: 'Brand Story', text: 'Emotional brand story, human moments, natural light, cinematic depth of field' },
  { id: 'sale', label: 'Sale Promo', text: 'High-energy sale announcement, bold motion, celebratory confetti and light bursts' },
];

const LANGUAGES = ['Hindi', 'Urdu'];

const STORIES = {
  market: {
    title: 'Mango vs Strawberry',
    description: 'A funny argument for the crown of the fruit market.',
    scenes: [
      { character: 'Mango', dialogue: 'Suno bhai, is fruit market ka asli raja main hoon! Meri mithaas ka koi muqabla nahi!',
        prompt: 'A cute golden yellow anthropomorphic mango character with large expressive eyes, tiny arms and a clearly visible mouth, standing proudly in a colorful Indian fruit market, funny confident expression' },
      { character: 'Strawberry', dialogue: 'Raja ji, pehle apni shakal toh dekho! Laal rang aur style mein mujhse aage koi nahi!',
        prompt: 'A cute bright red anthropomorphic strawberry character with green leafy top, large expressive eyes, tiny arms and a clearly visible mouth, teasing a mango in an Indian fruit market' },
      { character: 'Mango', dialogue: 'Arey, garmiyon mein sab mujhe dhoondte hain! Aam ka mausam aaye toh baaki sab peeche reh jaate hain!',
        prompt: 'The same golden yellow anthropomorphic mango character boasting in a busy colorful Indian fruit market, expressive mouth and eyes, playful hand gestures, cinematic close-up' },
      { character: 'Strawberry', dialogue: 'Wah! Lekin selfie mein sab mere saath photo lete hain. Asli star toh main hoon!',
        prompt: 'The same bright red anthropomorphic strawberry character posing like a celebrity while the mango reacts in surprise, colorful Indian fruit market, expressive face' },
    ],
  },
  friendship: {
    title: 'Fruit Market Friendship',
    description: 'Two rivals discover that teamwork wins.',
    scenes: [
      { character: 'Mango', dialogue: 'Main sabse meetha hoon, isliye sab mere dost banna chahte hain!',
        prompt: 'A cute golden mango cartoon character bragging in a colorful fruit market, expressive face and visible mouth' },
      { character: 'Strawberry', dialogue: 'Dosti mithaas se nahi, achhe dil se hoti hai!',
        prompt: 'A cute red strawberry cartoon character responding confidently to a mango, expressive eyes and visible mouth, colorful fruit market' },
      { character: 'Mango', dialogue: 'Toh phir hum dono milkar sabko khush kar sakte hain!',
        prompt: 'A cute golden mango character smiling and reaching out to a red strawberry character in a sunny fruit market' },
      { character: 'Strawberry', dialogue: 'Pakka! Dosti bhi superhit aur fruit salad bhi!',
        prompt: 'A cute mango and strawberry cartoon duo celebrating together in a colorful fruit market, happy expressive faces, funny family-friendly ending' },
    ],
  },
};

// Explore wall. Replace the Unsplash URLs with your own licensed artwork before a big launch.
const SCENES = [
  { title: 'Aurora Princess', category: 'Fantasy', style: 'Anime Film',
    image: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1000&q=85',
    prompt: 'An anime heroine beneath a luminous emerald aurora in a frozen fantasy kingdom, drifting snow, magical particles, expressive eyes' },
  { title: 'Spirit of Sakura', category: 'Anime', style: 'Anime Film',
    image: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?auto=format&fit=crop&w=1000&q=85',
    prompt: 'An anime-inspired heroine surrounded by falling cherry blossom petals at twilight, glowing lanterns, dreamy pink and blue lighting' },
  { title: 'Midnight Tokyo', category: 'Cyberpunk', style: 'Cyberpunk',
    image: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1000&q=85',
    prompt: 'A futuristic anime city at midnight, neon cyan and magenta lights, reflective wet streets, atmospheric fog' },
  { title: 'Ocean Dream', category: 'Dreamscape', style: 'Dreamscape',
    image: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1000&q=85',
    prompt: 'A dreamy anime ocean beneath a luminous sky, sparkling waves, glowing clouds and detailed fantasy scenery' },
];

const pick = (list, id) => list.find((x) => x.id === id) || list[0];

// Builds the final text prompt. Pure function, safe on server and client.
function buildPrompt(o = {}) {
  const parts = [String(o.prompt || '').trim()];
  if (o.mode === 'ad' || o.ad) {
    const ad = o.ad || {};
    const tpl = pick(AD_TEMPLATES, ad.template);
    parts.push(tpl.text);
    if (ad.brandName) parts.push(`Brand: ${String(ad.brandName).slice(0, 80)}`);
    if (ad.productName) parts.push(`Product: ${String(ad.productName).slice(0, 120)}`);
    if (ad.callToAction) parts.push(`Closing call to action idea: ${String(ad.callToAction).slice(0, 80)}`);
  }
  const cam = pick(CAMERAS, o.camera).text;
  const mood = pick(MOODS, o.mood).text;
  if (o.style) parts.push(`Visual style: ${String(o.style).slice(0, 40)}`);
  if (cam) parts.push(`Camera: ${cam}`);
  if (mood) parts.push(`Mood: ${mood}`);
  return parts.filter(Boolean).join('. ').replace(/\.\./g, '.').slice(0, 1800);
}

// Prompt Director: three differently-flavoured rewrites of the user's idea.
function directorVariants(o = {}) {
  const base = String(o.prompt || '').trim();
  if (!base) return [];
  const tail = 'Coherent motion, detailed lighting, stable faces, no flicker, no on-screen text.';
  return [
    { label: 'Epic', prompt: `${base}. Epic scale, dramatic volumetric light, sweeping crane movement revealing the world. ${tail}`.slice(0, 1800) },
    { label: 'Intimate', prompt: `${base}. Intimate close framing, shallow depth of field, soft natural light, slow dolly-in on the emotion. ${tail}`.slice(0, 1800) },
    { label: 'Surreal', prompt: `${base}. Surreal dreamlike twist, impossible physics, glowing particles, slow orbiting camera. ${tail}`.slice(0, 1800) },
  ];
}

// Lightweight safety screen. Providers also moderate; this is a first line of defence.
const BLOCKED = [
  /\b(nude|naked|nsfw|porn\w*|explicit sex\w*|erotic)\b/i,
  /\b(child|kid|minor|teen\w*|underage|schoolgirl|schoolboy)\b.{0,40}\b(sexual|nude|naked|erotic)\b/i,
  /\b(sexual|nude|naked|erotic)\b.{0,40}\b(child|kid|minor|teen\w*|underage|schoolgirl|schoolboy)\b/i,
  /\b(deepfake|face[- ]?swap)\b/i,
  /\b(beheading|gore|dismember\w*|torture)\b/i,
  /\b(make a bomb|build a bomb|bioweapon|nerve agent)\b/i,
];
function screenPrompt(text) {
  const t = String(text || '');
  return BLOCKED.some((re) => re.test(t)) ? 'This prompt breaks the VYRA content rules. Please describe a different scene.' : null;
}

module.exports = { STYLES, CAMERAS, MOODS, AD_TEMPLATES, LANGUAGES, STORIES, SCENES, buildPrompt, directorVariants, screenPrompt };
