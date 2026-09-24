import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const PORT = Number(process.env.PORT || 8080);

const app = express();
app.disable('x-powered-by');

// ---------- Same-origin proxy for Supabase (used when VITE_ vars are not injected) ----------
const BAAAS_ROUTES = ['/auth/v1', '/rest/v1', '/storage/v1', '/realtime/v1', '/pg'];
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  app.all(
    BAAAS_ROUTES.map((p) => `${p}/*`),
    express.raw({ type: () => true, limit: '25mb' }),
    async (req, res) => {
      try {
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (['host', 'content-length', 'connection'].includes(k)) continue;
          headers[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        headers['apikey'] = SUPABASE_ANON_KEY;
        if (!headers['authorization']) headers['authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;

        const target = `${SUPABASE_URL}${req.originalUrl}`;
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : req.body;
        const upstream = await fetch(target, {
          method: req.method,
          headers,
          body,
        });
        res.status(upstream.status);
        upstream.headers.forEach((v, k) => {
          if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) {
            res.setHeader(k, v);
          }
        });
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.send(buf);
      } catch (err) {
        res.status(502).json({ error: 'upstream_error', message: String(err) });
      }
    },
  );
}

app.use(express.json({ limit: '2mb' }));

// ---------- AI image generation (Gemini) ----------
app.post('/api/generate-ai-image', async (req, res) => {
  const jwt = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!jwt) {
    return res.status(401).json({ status: 'error', message: 'ログインが必要です' });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ status: 'error', message: 'サーバー設定が不完全です' });
  }

  let user;
  try {
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!ures.ok) {
      return res.status(401).json({ status: 'error', message: '認証の有効期限が切れています。再ログインしてください。' });
    }
    user = await ures.json();
  } catch {
    return res.status(502).json({ status: 'error', message: '認証サービスに接続できません' });
  }

  const { title = '', desc = '' } = req.body || {};
  if (!String(title).trim()) {
    return res.status(400).json({ status: 'error', message: 'タイトルを入力してください' });
  }

  if (!GEMINI_API_KEY) {
    return res.json({
      status: 'ok',
      url: null,
      message:
        'AI画像生成は現在準備中です。画像をアップロードするか、テキストのみで投稿してください。',
    });
  }

  try {
    const prompt = `3D printable product concept: ${String(title).trim()}. ${String(desc).trim()}. Clear product design, isolated on clean white background, isometric view, studio lighting, high detail.`;
    const gr = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1' },
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    const gdata = await gr.json();
    const b64 = gdata?.predictions?.[0]?.bytesBase64Encoded;
    if (!gr.ok || !b64) {
      console.error('Gemini API error:', JSON.stringify(gdata).slice(0, 500));
      throw new Error(gdata?.error?.message || 'AI生成に失敗しました');
    }

    const img = Buffer.from(b64, 'base64');
    const objectPath = `${user.id}/ai_${randomUUID()}.png`;
    const upres = await fetch(`${SUPABASE_URL}/storage/v1/object/uploads/${objectPath}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: img,
    });
    if (!upres.ok) {
      console.error('Storage upload error:', (await upres.text()).slice(0, 300));
      throw new Error('画像の保存に失敗しました');
    }

    return res.json({
      status: 'ok',
      url: `${SUPABASE_URL}/storage/v1/object/public/uploads/${objectPath}`,
    });
  } catch (e) {
    console.error('AI image generation failed:', e);
    return res.json({
      status: 'ok',
      url: null,
      message: 'AI画像の生成に失敗しました。画像をアップロードするか、テキストのみで投稿してください。',
    });
  }
});

// ---------- Static frontend ----------
app.use(express.static(DIST));
app.get(/^\/(?!api\/|auth\/|rest\/|storage\/|realtime\/|pg).*/, (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Idea Factory server listening on 0.0.0.0:${PORT}`);
});
