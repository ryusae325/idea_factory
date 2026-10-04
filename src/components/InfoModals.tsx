import { useState } from 'react';
import type { ReactNode } from 'react';

const OPERATOR_EMAIL = 'suda.ryuga.325@gmail.com';

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl shadow-slate-900/20"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="space-y-4 px-5 py-5 text-sm leading-relaxed text-slate-600">{children}</div>
      </div>
    </div>
  );
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <Shell title="運営情報" onClose={onClose}>
      <section className="rounded-xl bg-slate-50 p-4">
        <h4 className="mb-2 font-bold text-slate-800">運営理念</h4>
        <p>
          PlanMo（プランモ）は、「良いアイデアが、つくる技術に出会える社会」をめざす共創プラットフォームです。
          アイデアを持つプランナーと、3Dモデリングの技術を持つモデラーをつなぎ、
          企画・制作・販売までを公正な収益分配で完結できる場を提供します。
        </p>
      </section>
      <section className="rounded-xl bg-slate-50 p-4">
        <h4 className="mb-2 font-bold text-slate-800">サービス概要</h4>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2">
          <dt className="font-semibold text-slate-500">サービス名</dt>
          <dd>PlanMo（プランモ）</dd>
          <dt className="font-semibold text-slate-500">提供内容</dt>
          <dd>アイデア募集・3Dモデリング受注・プリント品/STLデータ販売</dd>
          <dt className="font-semibold text-slate-500">決済</dt>
          <dd>Stripe（クレジットカード決済）</dd>
          <dt className="font-semibold text-slate-500">連絡先</dt>
          <dd>
            電話: 080-2362-0325（平日 9:00〜18:00）
            <br />
            メール: {OPERATOR_EMAIL}
          </dd>
        </dl>
      </section>
    </Shell>
  );
}

const FAQS: { q: string; a: string }[] = [
  {
    q: 'PlanMo は無料で利用できますか？',
    a: '登録・アイデア投稿・モデリングへの参加はすべて無料です。商品を購入いただく際にのみ代金が発生します。',
  },
  {
    q: '収益はどのように分配されますか？',
    a: '商品が売れると、投稿時に設定した分配率（プランナー／モデラー）に応じて売上残高に加算されます。残高はマイページの「売上・ギフト」からデジタルギフトに交換申請できます。',
  },
  {
    q: 'プリント品と STLデータの違いは何ですか？',
    a: 'プリント品は運営が提携印刷事業者で製造・配送する実物商品です。STLデータは3Dプリンタで出力できるデータファイルで、購入後すぐにダウンロードできます。',
  },
  {
    q: '製造・配送費は別にかかりますか？',
    a: 'はい。プリント品の価格に加えて、サイズ階級（S/M/L/XL）ごとの製造・配送費が購入時に加算されます。STLデータ購入の場合はかかりません。',
  },
  {
    q: '権利侵害の心配があります',
    a: 'すべての投稿には AI による権利侵害リスクチェックが提供され、問題があれば運営が確認・対応します。万一お困りの場合はお問い合わせからご連絡ください。',
  },
  {
    q: '決済は安全ですか？',
    a: '決済は Stripe が処理し、クレジットカード情報は PlanMo サーバーに一切保存されません。通信はすべて暗号化（HTTPS）されています。',
  },
  {
    q: '返品・返金はできますか？',
    a: 'STLデータなどデジタル商品の特性上、購入確定後の返金はできません。プリント品は到着から7日以内に初期不良等をご連絡いただければ交換または返金いたします。',
  },
];

export function FaqModal({ onClose }: { onClose: () => void }) {
  return (
    <Shell title="よくある質問（FAQ）" onClose={onClose}>
      <div className="space-y-3">
        {FAQS.map((f, i) => (
          <details key={i} className="group rounded-xl border border-slate-200 bg-white px-4 py-3 open:bg-slate-50">
            <summary className="cursor-pointer list-none font-semibold text-slate-800 marker:hidden">
              <span className="mr-2 text-blue-600">Q</span>
              {f.q}
              <span className="float-right text-slate-400 transition group-open:rotate-180">▾</span>
            </summary>
            <p className="mt-3 border-t border-slate-100 pt-3">
              <span className="mr-2 font-semibold text-slate-500">A</span>
              {f.a}
            </p>
          </details>
        ))}
      </div>
    </Shell>
  );
}

export function ContactModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const send = () => {
    if (!name.trim() || !email.trim() || !message.trim()) return;
    const subject = encodeURIComponent(`[PlanMo お問い合わせ] ${name.trim()}`);
    const body = encodeURIComponent(`お名前: ${name.trim()}\nメール: ${email.trim()}\n\n${message.trim()}`);
    window.location.href = `mailto:${OPERATOR_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <Shell title="お問い合わせ" onClose={onClose}>
      <p className="text-xs text-slate-500">
        返信まで 1〜3 営業日ほどかかる場合があります。お急ぎの場合は電話（080-2362-0325・平日 9:00〜18:00）までご連絡ください。
      </p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">お名前</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="山田 太郎"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">メールアドレス</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-700">お問い合わせ内容</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            placeholder="ご不明点・ご報告などをご記入ください"
          />
        </div>
        <button
          onClick={send}
          disabled={!name.trim() || !email.trim() || !message.trim()}
          className="brass-btn w-full rounded-full px-6 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
        >
          メールアプリで送信
        </button>
        <p className="text-center text-[11px] text-slate-400">
          送信ボタンを押すと、ご利用のメールアプリが開きます。
        </p>
      </div>
    </Shell>
  );
}

export function SafetyModal({ onClose }: { onClose: () => void }) {
  const items = [
    {
      icon: '🛡️',
      title: '権利の保護',
      body: '投稿には AI による商標・著作権・意匠権リスクの自動チェックを提供。運営が不適切なコンテンツを監視・対応しています。',
    },
    {
      icon: '💳',
      title: '決済の安全性',
      body: '決済は世界的な決済基盤 Stripe が処理します。カード情報は PlanMo に保存されず、通信はすべて暗号化されています。',
    },
    {
      icon: '🤝',
      title: '公正な収益分配',
      body: '売上は投稿時に設定した分配率に従い、自動でプランナーとモデラーに配分されます。分配率はいつでも確認できます。',
    },
    {
      icon: '🔒',
      title: '個人情報の保護',
      body: '配送先情報は製造・配送の目的にのみ使用し、第三者に提供しません。詳細はプライバシーポリシーをご確認ください。',
    },
  ];
  return (
    <Shell title="安心・安全への取り組み" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-2xl">{it.icon}</p>
            <h4 className="mt-1 font-bold text-slate-800">{it.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{it.body}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}
