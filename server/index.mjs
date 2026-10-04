import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHmac } from 'node:crypto';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_WEBHOOK_TOKEN = process.env.STRIPE_WEBHOOK_TOKEN || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ---------- 許可 Origin ----------
const DEFAULT_ORIGIN = `http://localhost:${PORT}`;
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);
allowedOrigins.add(DEFAULT_ORIGIN);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  // サブドメイン許可の場合はワイルドカード対応も可能（必要に応じて）
  return false;
}

function safeOrigin(origin) {
  if (origin && isAllowedOrigin(origin)) return origin;
  return DEFAULT_ORIGIN;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- Security headers ----------
function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "connect-src 'self' https://*.stripe.com https://*.googleapis.com https://*.supabase.co https://*.verdent.ai; " +
      "frame-src 'self' https://accounts.google.com https://*.stripe.com; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self' https://accounts.google.com;",
  );
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}
app.use(securityHeaders);

// ---------- CORS ----------
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// ---------- Rate limiting (in-memory) ----------
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_DEFAULT = 100;
const RATE_LIMIT_STRICT = 10;
const rateMap = new Map();

function getClientIp(req) {
  return (
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function checkRateLimit(req, limit) {
  const ip = getClientIp(req);
  const key = `${ip}:${req.path}`;
  const now = Date.now();
  const record = rateMap.get(key) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_WINDOW_MS;
  }
  record.count += 1;
  rateMap.set(key, record);
  if (record.count > limit) {
    return false;
  }
  return true;
}

function rateLimitMiddleware(limit = RATE_LIMIT_DEFAULT) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (!checkRateLimit(req, limit)) {
      console.warn(`Rate limit exceeded: ${getClientIp(req)} ${req.method} ${req.path}`);
      return res.status(429).json({ status: 'error', message: 'リクエストが多すぎます。しばらく経ってからお試しください。' });
    }
    next();
  };
}

app.use(rateLimitMiddleware(RATE_LIMIT_DEFAULT));

// ---------- Same-origin proxy for Supabase (used when VITE_ vars are not injected) ----------
const BAAAS_ROUTES = ['/auth/v1', '/rest/v1', '/storage/v1', '/realtime/v1', '/pg'];
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  app.all(
    BAAAS_ROUTES.map((p) => `${p}/*`),
    express.raw({ type: () => true, limit: '25mb' }),
    async (req, res) => {
      try {
        // 転送するヘッダーを制限しつつ、Supabase Auth/REST/Storage に必要なものは確保
        const headers = {};
        const allowedReqHeaders = [
          'content-type',
          'content-length',
          'accept',
          'accept-language',
          'accept-encoding',
          'prefer',
          'x-client-info',
          'x-supabase-api-version',
          'x-request-id',
          'range',
          'origin',
          'referer',
        ];
        for (const k of allowedReqHeaders) {
          const v = req.headers[k];
          if (v) headers[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        const auth = req.headers.authorization;
        if (auth) headers.authorization = Array.isArray(auth) ? auth.join(', ') : auth;
        headers.apikey = SUPABASE_ANON_KEY;
        if (!headers.authorization) headers.authorization = `Bearer ${SUPABASE_ANON_KEY}`;

        const target = `${SUPABASE_URL}${req.originalUrl}`;
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : req.body;
        const upstream = await fetch(target, {
          method: req.method,
          headers,
          body,
          signal: AbortSignal.timeout(30000),
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
        console.error('BaaS proxy error:', err.message);
        res.status(502).json({ error: 'upstream_error', message: '認証サービスに接続できません' });
      }
    },
  );
}

// ---------- Stripe Webhook（JSONパーサーの前にraw bodyで受信） ----------
app.post(
  '/api/stripe/webhook',
  rateLimitMiddleware(RATE_LIMIT_STRICT),
  express.raw({ type: () => true, limit: '2mb' }),
  async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ received: false, error: 'stripe not configured' });
    }

    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ received: false, error: 'invalid signature' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const sessionId = session.id;
      try {
        if (!STRIPE_WEBHOOK_TOKEN) {
          console.error('STRIPE_WEBHOOK_TOKEN is not configured; skipping webhook DB processing');
        } else {
          const sigHmac = createHmac('sha256', STRIPE_WEBHOOK_TOKEN)
            .update(sessionId)
            .digest('hex');
          const shipping = extractShipping(session);
          const body = shipping
            ? { p_session_id: sessionId, p_sig: sigHmac, p_shipping: shipping }
            : { p_session_id: sessionId, p_sig: sigHmac };
          const webhookKey = SUPABASE_SERVICE_ROLE_KEY;
          if (!webhookKey) {
            console.error('SUPABASE_SERVICE_ROLE_KEY is not set; cannot process webhook securely');
          } else {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/complete_purchase_webhook`, {
              method: 'POST',
              headers: {
                apikey: webhookKey,
                Authorization: `Bearer ${webhookKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(30000),
            });
            if (!r.ok) {
              console.error('webhook rpc error:', (await r.text()).slice(0, 300));
            } else {
              console.log(`webhook processed ${sessionId}: ${await r.text()}`);
            }
          }
        }
      } catch (e) {
        console.error('webhook processing error:', e);
      }
    }

    return res.json({ received: true });
  },
);

app.use(express.json({ limit: '2mb' }));

// ---------- Stripe住所の抽出（新旧API両対応） ----------
function extractShipping(session) {
  const det = session?.collected_information?.shipping_details ?? session?.shipping_details ?? null;
  if (!det?.address) return null;
  const a = det.address;
  const street = [a.line1, a.line2].filter(Boolean).join(' ');
  const full = [a.state, a.city, street].filter(Boolean).join(' ');
  return {
    name: det.name ?? '',
    postal: a.postal_code ? `〒${a.postal_code}` : '',
    address: full,
    phone:
      session?.collected_information?.phone_number ?? session?.customer_details?.phone ?? '',
  };
}

// ---------- 共通ヘルパー ----------
function clientError(message) {
  return { status: 'error', message };
}

function serverError() {
  return { status: 'error', message: 'サーバーエラーが発生しました' };
}

async function getAuthUser(req) {
  const jwt = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!jwt || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!ures.ok) return null;
    return await ures.json();
  } catch {
    return null;
  }
}

async function callRpc(name, args, jwt) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    let msg = `RPC ${name} failed`;
    try {
      const err = await r.json();
      if (err?.message) msg = err.message;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

async function fetchIdeaById(ideaId) {
  const ir = await fetch(`${SUPABASE_URL}/rest/v1/ideas?id=eq.${Number(ideaId)}&select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!ir.ok) return null;
  const rows = await ir.json();
  return rows?.[0] ?? null;
}

function isPositiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function isNonEmptyString(value, maxLen = 5000) {
  const s = String(value || '').trim();
  return s.length > 0 && s.length <= maxLen;
}

async function requireAdmin(req, res) {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json(clientError('ログインが必要です'));
    return null;
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    res.status(503).json(clientError('管理機能は現在利用できません'));
    return null;
  }

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!profileRes.ok) throw new Error(`Admin authorization lookup failed: ${profileRes.status}`);
  const profiles = await profileRes.json();
  if (!profiles?.[0]?.is_admin) {
    res.status(403).json(clientError('管理者権限が必要です'));
    return null;
  }
  return user;
}

function serviceRoleHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

// ---------- Stripe Checkout ----------
// 製造・配送費（購入者負担・サイズ階級別固定額）
const FULFILLMENT_FEES = { S: 900, M: 1600, L: 2900, XL: 5500 };

app.post(
  '/api/create-checkout-session',
  rateLimitMiddleware(RATE_LIMIT_STRICT),
  async (req, res) => {
    const jwt = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json(clientError('ログインが必要です'));
    }

    const { idea_id, item_type } = req.body || {};
    if (!isPositiveInteger(idea_id)) {
      return res.status(400).json(clientError('商品IDが不正です'));
    }
    if (!['physical', 'digital'].includes(item_type)) {
      return res.status(400).json(clientError('不正な商品種別です'));
    }

    try {
      const idea = await fetchIdeaById(idea_id);
      if (!idea) {
        return res.status(404).json(clientError('商品が見つかりません'));
      }
      if (idea.status !== '販売中') {
        return res.status(400).json(clientError('販売中の商品のみ購入できます'));
      }

      const price = item_type === 'physical' ? idea.price_physical : idea.price_digital;
      const fee = item_type === 'physical' ? FULFILLMENT_FEES[idea.size_tier] ?? FULFILLMENT_FEES.S : 0;

      // 無料（0円）の場合は決済を挟まず直接確定
      if (price <= 0 && fee <= 0) {
        const msg = await callRpc('buy_item', { p_idea_id: idea.id, p_item_type: item_type }, jwt);
        return res.json({ status: 'ok', direct: true, message: msg });
      }

      if (!stripe) {
        return res.status(500).json(serverError());
      }

      // Stripe Customer を取得または作成（カード保存 → 次回以降すぐに購入できる）
      let customerId = null;
      try {
        const found = await stripe.customers.search({
          query: `metadata['planmo_user_id']:'${user.id}'`,
          limit: 1,
        });
        customerId = found.data[0]?.id ?? null;
      } catch {}
      if (!customerId) {
        try {
          const byEmail = user.email
            ? await stripe.customers.list({ email: user.email, limit: 20 })
            : { data: [] };
          customerId = byEmail.data.find((c) => c.metadata?.planmo_user_id === user.id)?.id ?? null;
        } catch {}
      }
      if (!customerId) {
        try {
          const cust = await stripe.customers.create({
            email: user.email || undefined,
            metadata: { planmo_user_id: user.id },
          });
          customerId = cust.id;
        } catch {}
      }

      const origin = safeOrigin(req.headers.origin);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...(customerId ? { customer: customerId, payment_intent_data: { setup_future_usage: 'on_session' } } : {}),
        ...(item_type === 'physical'
          ? {
              shipping_address_collection: { allowed_countries: ['JP'] },
              phone_number_collection: { enabled: true },
            }
          : {}),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'jpy',
              unit_amount: price,
              product_data: {
                name: idea.title,
                description: item_type === 'physical' ? '物理プリント品' : 'STLデータ',
              },
            },
          },
          ...(fee > 0
            ? [
                {
                  quantity: 1,
                  price_data: {
                    currency: 'jpy',
                    unit_amount: fee,
                    product_data: {
                      name: '製造・配送費',
                      description: `サイズ階級: ${idea.size_tier ?? 'S'}`,
                    },
                  },
                },
              ]
            : []),
        ],
        success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?payment=cancelled`,
        client_reference_id: user.id,
        metadata: { idea_id: String(idea.id), item_type, user_id: user.id },
      });

      const ins = await fetch(`${SUPABASE_URL}/rest/v1/payment_sessions`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          id: session.id,
          user_id: user.id,
          idea_id: idea.id,
          item_type,
          amount: price,
          fulfillment_fee: fee,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!ins.ok) {
        console.error('payment_sessions insert error:', (await ins.text()).slice(0, 300));
        throw new Error('決済セッションの記録に失敗しました');
      }

      return res.json({ status: 'ok', url: session.url });
    } catch (e) {
      console.error('create-checkout-session error:', e);
      return res.status(500).json(serverError());
    }
  },
);

app.post('/api/complete-checkout', rateLimitMiddleware(RATE_LIMIT_STRICT), async (req, res) => {
  const jwt = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json(clientError('ログインが必要です'));
  }
  if (!stripe) {
    return res.status(500).json(serverError());
  }

  const { session_id } = req.body || {};
  if (!session_id || !/^cs_[A-Za-z0-9_]+$/.test(session_id)) {
    return res.status(400).json(clientError('session_id が必要です'));
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') {
      return res.status(400).json(clientError('決済が完了していません'));
    }
    const shipping = extractShipping(session);
    const msg = await callRpc(
      'complete_purchase',
      shipping ? { p_session_id: session_id, p_shipping: shipping } : { p_session_id: session_id },
      jwt,
    );
    return res.json({ status: 'ok', message: msg });
  } catch (e) {
    console.error('complete-checkout error:', e);
    return res.status(500).json(serverError());
  }
});

// ---------- AI status（キー設定済みかどうかのみ返す） ----------
app.get('/api/ai-status', rateLimitMiddleware(RATE_LIMIT_DEFAULT), (_req, res) => {
  res.json({ imageReady: !!GEMINI_API_KEY, checkReady: !!GEMINI_API_KEY });
});

// ---------- AI 権利侵害チェック（Gemini テキストモデル） ----------
app.post(
  '/api/check-infringement',
  rateLimitMiddleware(RATE_LIMIT_STRICT),
  async (req, res) => {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json(clientError('ログインが必要です'));
    }
    if (!GEMINI_API_KEY) {
      return res.status(503).json({ status: 'unavailable', message: 'AIチェック機能は現在準備中です。' });
    }

    const { title = '', desc = '' } = req.body || {};
    if (!isNonEmptyString(title, 200)) {
      return res.status(400).json(clientError('タイトルを入力してください（200文字以内）'));
    }
    if (desc && String(desc).length > 2000) {
      return res.status(400).json(clientError('説明は2000文字以内で入力してください'));
    }

    try {
      const prompt = `あなたは日本の知的財産権の専門家です。以下の3Dプリント製品のアイデアについて、商標権・著作権・意匠権・既存商品との類似性の観点からリスクを評価してください。

【アイデアタイトル】${String(title).trim()}
【詳細説明】${String(desc).trim() || '（記載なし）'}

以下のJSON形式のみで回答してください（前後に説明文を入れないでください）:
{"risk_level": "低" | "中" | "高", "summary": "50文字以内の総評", "points": ["懸念点または問題なしの理由を30〜80文字ずつ、最大3点"]}`;

      const gr = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 },
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      const gdata = await gr.json();
      const text = gdata?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!gr.ok || !text) {
        console.error('Gemini check error:', JSON.stringify(gdata).slice(0, 500));
        throw new Error(gdata?.error?.message || 'AIチェックに失敗しました');
      }

      let parsed;
      try {
        const m = text.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m ? m[0] : text);
      } catch {
        parsed = { risk_level: '不明', summary: text.slice(0, 120), points: [] };
      }

      return res.json({ status: 'ok', ...parsed });
    } catch (e) {
      console.error('check-infringement error:', e);
      return res.status(500).json(serverError());
    }
  },
);

// ---------- 権利侵害・類似品の通報受付と運営管理 ----------
app.post('/api/report-idea', rateLimitMiddleware(RATE_LIMIT_STRICT), async (req, res) => {
  const { idea_id, reason } = req.body || {};
  if (!isPositiveInteger(idea_id)) {
    return res.status(400).json(clientError('アイデアIDが不正です'));
  }
  if (!isNonEmptyString(reason, 2000)) {
    return res.status(400).json(clientError('通報内容を入力してください（2000文字以内）'));
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json(clientError('通報受付は現在利用できません'));
  }

  try {
    const normalizedIdeaId = Number(idea_id);
    const ideaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ideas?id=eq.${normalizedIdeaId}&select=id,title`,
      { headers: serviceRoleHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (!ideaRes.ok) throw new Error(`Idea lookup failed: ${ideaRes.status}`);
    const ideas = await ideaRes.json();
    if (!ideas?.[0]) return res.status(404).json(clientError('対象の商品が見つかりません'));

    const reporter = await getAuthUser(req);
    const reportRes = await fetch(`${SUPABASE_URL}/rest/v1/idea_reports`, {
      method: 'POST',
      headers: serviceRoleHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({
        idea_id: normalizedIdeaId,
        idea_title: ideas[0].title,
        reporter_id: reporter?.id ?? null,
        reason: String(reason).trim(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!reportRes.ok) {
      console.error('Report persistence failed:', reportRes.status, await reportRes.text());
      return res.status(502).json(serverError());
    }
    const reports = await reportRes.json();
    console.info('[REPORT] accepted', JSON.stringify({ report_id: reports?.[0]?.id, idea_id: normalizedIdeaId }));
    return res.json({ status: 'ok', message: '通報を受理しました' });
  } catch (e) {
    console.error('report-idea error:', e);
    return res.status(502).json(serverError());
  }
});

app.get('/api/reports', rateLimitMiddleware(RATE_LIMIT_DEFAULT), async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const reportsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/idea_reports?select=id,idea_id,idea_title,reason,status,created_at,updated_at,reporter:profiles!idea_reports_reporter_id_fkey(username,display_name),idea:ideas!idea_reports_idea_id_fkey(id,title,status,is_hidden)&order=created_at.desc`,
      { headers: serviceRoleHeaders(), signal: AbortSignal.timeout(15000) },
    );
    if (!reportsRes.ok) {
      console.error('Report list failed:', reportsRes.status, await reportsRes.text());
      return res.status(502).json(serverError());
    }
    return res.json({ status: 'ok', reports: await reportsRes.json() });
  } catch (e) {
    console.error('reports list error:', e);
    return res.status(500).json(serverError());
  }
});

app.post('/api/reports/:report_id/status', rateLimitMiddleware(RATE_LIMIT_STRICT), async (req, res) => {
  const { report_id } = req.params;
  const { status, hide_idea = false, show_idea = false, delete: deleteReport = false } = req.body || {};
  if (!isPositiveInteger(report_id)) {
    return res.status(400).json(clientError('通報IDが不正です'));
  }
  if (typeof hide_idea !== 'boolean' || typeof show_idea !== 'boolean' || typeof deleteReport !== 'boolean') {
    return res.status(400).json(clientError('操作内容が不正です'));
  }
  if (hide_idea && show_idea) {
    return res.status(400).json(clientError('公開状態の指定が不正です'));
  }
  if (!deleteReport && !['未対応', '確認済み', '対処済み'].includes(status)) {
    return res.status(400).json(clientError('通報ステータスが不正です'));
  }

  try {
    if (!(await requireAdmin(req, res))) return;
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/manage_idea_report`, {
      method: 'POST',
      headers: serviceRoleHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        p_report_id: Number(report_id),
        p_status: deleteReport ? null : status,
        p_hide_idea: hide_idea,
        p_show_idea: show_idea,
        p_delete: deleteReport,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!rpcRes.ok) {
      console.error('Report action failed:', rpcRes.status, await rpcRes.text());
      return res.status(400).json(clientError('通報の更新に失敗しました'));
    }
    return res.json({ status: 'ok', message: deleteReport ? '通報を削除しました' : '通報を更新しました' });
  } catch (e) {
    console.error('report status error:', e);
    return res.status(500).json(serverError());
  }
});

// ---------- AI image generation (Gemini) ----------
app.post(
  '/api/generate-ai-image',
  rateLimitMiddleware(RATE_LIMIT_STRICT),
  async (req, res) => {
    const jwt = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    if (!jwt) {
      return res.status(401).json(clientError('ログインが必要です'));
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(500).json(serverError());
    }

    let user;
    try {
      const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!ures.ok) {
        return res.status(401).json(clientError('認証の有効期限が切れています。再ログインしてください。'));
      }
      user = await ures.json();
    } catch {
      return res.status(502).json(clientError('認証サービスに接続できません'));
    }

    const { title = '', desc = '' } = req.body || {};
    if (!isNonEmptyString(title, 200)) {
      return res.status(400).json(clientError('タイトルを入力してください（200文字以内）'));
    }
    if (desc && String(desc).length > 2000) {
      return res.status(400).json(clientError('説明は2000文字以内で入力してください'));
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

      // 1) まず Imagen（有料プラン向け）を試し、2) 失敗したら Gemini 画像生成モデルにフォールバック
      let b64 = null;
      let lastErr = null;

      try {
        const gr = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
            body: JSON.stringify({
              instances: [{ prompt }],
              parameters: { sampleCount: 1, aspectRatio: '1:1' },
            }),
            signal: AbortSignal.timeout(45000),
          },
        );
        const gdata = await gr.json();
        b64 = gdata?.predictions?.[0]?.bytesBase64Encoded ?? null;
        if (!gr.ok || !b64) {
          lastErr = new Error(gdata?.error?.message || 'imagen failed');
          console.error('Imagen error:', JSON.stringify(gdata).slice(0, 300));
        }
      } catch (e) {
        lastErr = e;
        console.error('Imagen request error:', e.message);
      }

      if (!b64) {
        // フォールバック: gemini-2.5-flash-image（無料枠で利用可能なモデル）
        const fr = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ['IMAGE'] },
            }),
            signal: AbortSignal.timeout(60000),
          },
        );
        const fdata = await fr.json();
        const parts = fdata?.candidates?.[0]?.content?.parts ?? [];
        const imgPart = parts.find((p) => p.inlineData?.data);
        b64 = imgPart?.inlineData?.data ?? null;
        if (!fr.ok || !b64) {
          console.error('Gemini image fallback error:', JSON.stringify(fdata).slice(0, 300));
          throw new Error(fdata?.error?.message || lastErr?.message || 'AI生成に失敗しました');
        }
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
        signal: AbortSignal.timeout(30000),
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
  },
);

// ---------- Static frontend ----------
app.use(
  express.static(DIST, {
    dotfiles: 'ignore',
    etag: true,
    maxAge: IS_PROD ? '1d' : 0,
  }),
);
app.get(/^\/(?!api\/|auth\/|rest\/|storage\/|realtime\/|pg).*/, (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PlanMo server listening on 0.0.0.0:${PORT}`);
});
