import { useState } from 'react';

type LegalTab = 'terms' | 'privacy' | 'act';

const TABS: { id: LegalTab; label: string }[] = [
  { id: 'terms', label: '利用規約' },
  { id: 'privacy', label: 'プライバシーポリシー' },
  { id: 'act', label: '特定商取引法に基づく表記' },
];

export default function LegalModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<LegalTab>('terms');

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">📜 法務・規約</h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-4 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 text-[13px] leading-relaxed text-slate-700">
          {tab === 'terms' && <Terms />}
          {tab === 'privacy' && <Privacy />}
          {tab === 'act' && <Act />}
        </div>
      </div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="mt-5 text-sm font-bold text-slate-900 first:mt-0">{children}</h4>;
}

function Terms() {
  return (
    <div className="space-y-2">
      <p className="text-xs text-rose-500">※以下は雛形です。運営開始前に【 】内の情報を必ずご確認・編集ください。</p>
      <H>第1条（適用）</H>
      <p>本規約は、ヒラメキ工房（以下「本サービス」）の利用条件を定めるものです。利用者は本サービスを利用した時点で本規約に同意したものとみなされます。</p>
      <H>第2条（アカウント）</H>
      <p>利用者は、登録情報を正確に保つ義務を負います。アカウントの譲渡・貸与は禁止します。</p>
      <H>第3条（ロールと権利）</H>
      <p>
        本サービスでは「考案者」「モデラー」「購入者」のロールを利用できます。
        アイデアの考案者はそのアイデアに関する権利を保有したまま投稿でき、モデラーは3Dデータ化した点での貢献に対する報酬分配を受ける権利を有します。
      </p>
      <H>第4条（収益分配）</H>
      <p>
        商品の売上から、プラットフォーム手数料として販売価格の30%を差し引いた額を、考案者とモデラーの間で商品ごとに設定された分配率（合計100%）に従い分配します。
        売上分配金の有効期限は付与日から180日間とし、期限を過ぎた分は失効します。
      </p>
      <H>第5条（デジタルデータの取扱い）</H>
      <p>
        STLデータ等のデジタル商品は、購入確定後にダウンロード可能となります。データの性格上、購入後の返金・キャンセルは受け付けられません。
        購入したデータを第三者に再配布・再販売すること、および自己の成果物と偽って公開することを禁止します。
      </p>
      <H>第6条（禁止事項）</H>
      <p>
        法令・権利（商標権・著作権・意匠権等）の侵害、他者のアイデアの無断流用、虚偽の情報投稿、本サービスの運営を妨害する行為を禁止します。
      </p>
      <H>第7条（コンテンツの管理責任）</H>
      <p>
        投稿されたアイデア・3Dデータが第三者の権利を侵害しないことは投稿者の責任において確認する必要があります。運営者は、権利侵害の申告を受けた場合、当該コンテンツの削除やアカウント停止を行うことがあります。
      </p>
      <H>第8条（免責）</H>
      <p>本サービスの利用により生じた利用者間のトラブル（商品品質・配送・権利関係等）については、運営者は故意又は重過失のある場合を除き責任を負いません。</p>
      <H>第9条（規約の変更）</H>
      <p>運営者は必要と判断した場合、本規約を変更できます。変更後に本サービスを利用した場合、変更後の規約に同意したものとみなします。</p>
    </div>
  );
}

function Privacy() {
  return (
    <div className="space-y-2">
      <p className="text-xs text-rose-500">※以下は雛形です。【 】内を運営者情報に合わせて編集してください。</p>
      <H>1. 取得する情報</H>
      <p>本サービスは、アカウント登録時のメールアドレス、表示名、利用履歴（投稿・購入・交換申請）、エラー発生時の技術情報を取得します。</p>
      <H>2. 利用目的</H>
      <p>アカウント管理、商品提供、売上分配の計算、サポート対応、不正利用の防止に利用します。</p>
      <H>3. 第三者提供</H>
      <p>
        決済処理はStripe（外部決済サービス）が行い、カード情報は本サービスに保存されません。
        法令に基づく場合を除き、利用者の同意なく個人情報を第三者に提供しません。
      </p>
      <H>4. 保存・管理</H>
      <p>データは暗号化されたデータベース（Supabase）に保存し、アクセス権限を限定して管理します。</p>
      <H>5. 開示・削除請求</H>
      <p>利用者はご自身の個人情報の開示・訂正・削除を求めることができます。【問い合わせ先】までご連絡ください。</p>
      <H>6. お問い合わせ</H>
      <p>【運営者名・連絡先メールアドレスを記載】</p>
    </div>
  );
}

function Act() {
  return (
    <div className="space-y-2">
      <p className="text-xs text-rose-500">※以下は雛形です。物理商品を販売する場合は法律上の記載義務があるため、必ず実情に合わせて記入してください。</p>
      <table className="mt-2 w-full text-left text-[13px]">
        <tbody>
          {[
            ['販売業者', '【運営者名】'],
            ['所在地', '【住所】'],
            ['連絡先', '【メールアドレス・電話番号等】'],
            ['販売価格', '各商品ページに表示された価格（消費税込み）'],
            ['支払方法', 'クレジットカード（Stripe経由）'],
            ['支払時期', '購入確定時に即時決済'],
            ['商品の引渡時期', 'デジタルデータ: 購入確定後即時ダウンロード可能 ／ 物理プリント品: 手配後、通常【2〜4週間】以内に発送'],
            ['返品・返金', 'デジタルデータの性格上、購入確定後の返品・返金はできません。物理プリント品に不備があった場合、【配送後7日以内】にご連絡ください。良品と交換または返金いたします。'],
            ['動作環境', 'STLデータは3Dプリンター用標準形式（STL）です。お使いのプリンター・スライサーとの互換性はご自身でご確認ください。'],
          ].map(([k, v]) => (
            <tr key={k} className="border-b border-slate-100 align-top">
              <th className="w-32 shrink-0 py-2 pr-3 font-semibold text-slate-500">{k}</th>
              <td className="py-2 text-slate-700">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
