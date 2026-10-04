import { supabase, authFetch } from './supabase';
import { toast } from './toast';
import type { Comment, ExchangeRequest, Idea, Order, BalanceEntry, Profile, Announcement, GiftStock, Notification, MyStats } from './types';

export const IDEA_SELECT = `*, creator:profiles!ideas_creator_id_fkey(username,display_name), modeler:profiles!ideas_modeler_id_fkey(username,display_name)`;

/** コメント数と評価統計をクライアント側で集計して ideas に付与する（PostgREST の埋め込み集計は無効のため） */
async function withStats(rows: Idea[]): Promise<Idea[]> {
  if (rows.length === 0) return rows;
  const [commentRows, ratingRows] = await Promise.all([
    supabase.from('comments').select('idea_id'),
    supabase.from('idea_ratings').select('idea_id,stars'),
  ]);
  const commentMap = new Map<number, number>();
  for (const r of commentRows.data ?? []) {
    const id = (r as { idea_id: number }).idea_id;
    commentMap.set(id, (commentMap.get(id) ?? 0) + 1);
  }
  const ratingMap = new Map<number, { sum: number; count: number }>();
  for (const r of ratingRows.data ?? []) {
    const { idea_id, stars } = r as { idea_id: number; stars: number };
    const cur = ratingMap.get(idea_id) ?? { sum: 0, count: 0 };
    cur.sum += stars;
    cur.count += 1;
    ratingMap.set(idea_id, cur);
  }
  return rows.map((i) => ({
    ...i,
    comment_count: commentMap.get(i.id) ?? 0,
    rating_stats: ratingMap.has(i.id)
      ? [{ avg: ratingMap.get(i.id)!.sum / ratingMap.get(i.id)!.count, count: ratingMap.get(i.id)!.count }]
      : null,
  }));
}

export async function fetchIdeas(): Promise<Idea[]> {
  const { data, error } = await supabase
    .from('ideas')
    .select(IDEA_SELECT)
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return withStats((data ?? []) as unknown as Idea[]);
}

/** コメント数 */
export function commentCount(idea: Idea): number {
  const c = idea.comment_count;
  if (Array.isArray(c)) return c[0]?.count ?? 0;
  return typeof c === 'number' ? c : 0;
}

/** 評価（平均★と件数。評価なしは null/null） */
export function ratingStats(idea: Idea): { avg: number | null; count: number } {
  const s = idea.rating_stats;
  const row = Array.isArray(s) ? s[0] : null;
  return { avg: row?.avg ?? null, count: row?.count ?? 0 };
}

/** 評価を投稿・更新（1ユーザー1アイデアにつき1票・上書き可） */
export async function rateIdea(ideaId: number, userId: string, stars: number) {
  const { error } = await supabase
    .from('idea_ratings')
    .upsert(
      { idea_id: ideaId, user_id: userId, stars, updated_at: new Date().toISOString() },
      { onConflict: 'idea_id,user_id' },
    );
  if (error) throw new Error(error.message);
}

/** 自分が付けた評価（未評価は null） */
export async function fetchMyRating(ideaId: number, userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('idea_ratings')
    .select('stars')
    .eq('idea_id', ideaId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { stars: number } | null)?.stars ?? null;
}

export async function fetchIdea(id: number): Promise<Idea | null> {
  const { data, error } = await supabase
    .from('ideas')
    .select(IDEA_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [withSt] = await withStats([data as unknown as Idea]);
  return withSt;
}

export async function fetchComments(ideaId: number): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*, author:profiles!comments_user_id_fkey(username,display_name)')
    .eq('idea_id', ideaId)
    .order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Comment[];
}

export async function postComment(ideaId: number, userId: string, content: string) {
  const { error } = await supabase
    .from('comments')
    .insert({ idea_id: ideaId, user_id: userId, content });
  if (error) throw new Error(error.message);
}

export async function deleteComment(commentId: number) {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) throw new Error(error.message);
}

export async function createIdea(values: {
  title: string;
  description: string;
  genre: string;
  image_url: string;
  images: string[];
  creator_id: string;
  creator_share: number;
  modeler_share: number;
  price_physical: number;
  price_digital: number;
  mfg_cost: number;
  size_tier: 'S' | 'M' | 'L' | 'XL';
}) {
  const { error } = await supabase.from('ideas').insert(values);
  if (error) throw new Error(error.message);
}

/** アイデアのジャンル（募集中一覧の絞り込み・ソート用） */
export const GENRES = [
  'ガジェット',
  '生活雑貨',
  'キッチン',
  'インテリア',
  'オフィス・文具',
  '趣味・ホビー',
  'フィギュア',
  'ペット用品',
  'その他',
] as const;

/** サイズ階級の定義（最低価格＝商品代金。fee＝製造・配送費は購入者負担） */
export const SIZE_OPTIONS = [
  { tier: 'S', range: '〜60mm × 60mm × 60mm', min: 1000, fee: 900 },
  { tier: 'M', range: '〜120mm × 120mm × 120mm', min: 2000, fee: 1600 },
  { tier: 'L', range: '〜200mm × 200mm × 200mm', min: 4000, fee: 2900 },
  { tier: 'XL', range: '200mm × 200mm × 200mm 超', min: 8000, fee: 5500 },
] as const;

export type SizeTier = (typeof SIZE_OPTIONS)[number]['tier'];

/** 階級から最低プリント価格を判定 */
export function tierMinPrice(tier: SizeTier): number {
  return SIZE_OPTIONS.find((o) => o.tier === tier)?.min ?? 1000;
}

/** 階級から製造・配送費を判定 */
export function fulfillmentFee(tier: SizeTier): number {
  return SIZE_OPTIONS.find((o) => o.tier === tier)?.fee ?? 900;
}

/** 削除リクエスト（相手の承認が必要。モデラー未定なら即時削除） */
export async function requestIdeaDelete(id: number): Promise<string> {
  const { data, error } = await supabase.rpc('request_idea_delete', { p_idea_id: id });
  if (error) throw new Error(error.message);
  return (data as string) ?? 'リクエストしました';
}

/** 削除の承認（相手側が実行） */
export async function confirmIdeaDelete(id: number): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_idea_delete', { p_idea_id: id });
  if (error) throw new Error(error.message);
  return (data as string) ?? '削除しました';
}

export async function updateIdeaStatus(
  id: number,
  status: '制作中' | '提出中' | '販売中' | '修正依頼' | '取り下げ',
  comment?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('update_idea_status', {
    p_idea_id: id,
    p_new_status: status,
    p_comment: comment ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? '更新しました';
}

export async function createCheckout(
  id: number,
  itemType: 'physical' | 'digital',
): Promise<{ kind: 'redirect'; url: string } | { kind: 'direct'; message: string }> {
  const res = await authFetch('/api/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea_id: id, item_type: itemType }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '決済の開始に失敗しました');
  if (data.direct) return { kind: 'direct', message: data.message as string };
  return { kind: 'redirect', url: data.url as string };
}

export async function completeCheckout(sessionId: string): Promise<string> {
  const res = await authFetch('/api/complete-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '決済の確定処理に失敗しました');
  return data.message as string;
}

/** 権利侵害・類似品の通報（カード/詳細モーダル共通） */
export async function reportIdea(ideaId: number, title: string): Promise<void> {
  const reason = window.prompt(
    `📢 通報：${title}\n\n類似している既製品の名前、キャラクター名、参考URLなどを入力してください。`,
  );
  if (reason === null) return;
  if (!reason.trim()) {
    toast('通報内容を入力してください', 'error');
    return;
  }
  const res = await authFetch('/api/report-idea', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea_id: ideaId, reason: reason.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '通報の送信に失敗しました');
  toast('📢 通報を受け付けました。運営にて内容を確認いたします。');
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Profile) ?? null;
}

export async function updateProfile(
  userId: string,
  values: { display_name: string },
) {
  const { error } = await supabase
    .from('profiles')
    .update(values)
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function fetchMyOrders(userId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, idea:ideas(title)')
    .eq('user_id', userId)
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Order[];
}

export async function fetchMyBalanceHistory(userId: string): Promise<BalanceEntry[]> {
  const { data, error } = await supabase
    .from('balance_history')
    .select('*')
    .eq('user_id', userId)
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BalanceEntry[];
}

export async function requestExchange(exchangeType: string, amount: number): Promise<string> {
  const { data, error } = await supabase.rpc('request_exchange', {
    p_exchange_type: exchangeType,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? '申請を受け付けました';
}

export async function fetchMyExchangeRequests(userId: string): Promise<ExchangeRequest[]> {
  const { data, error } = await supabase
    .from('exchange_requests')
    .select('*')
    .eq('user_id', userId)
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ExchangeRequest[];
}

export async function fetchAllExchangeRequests(): Promise<ExchangeRequest[]> {
  const { data, error } = await supabase
    .from('exchange_requests')
    .select('*, requester:profiles!exchange_requests_user_id_fkey(username,display_name)')
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ExchangeRequest[];
}

export async function fetchAllOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, idea:ideas(title), buyer:profiles!orders_user_id_fkey(username,display_name)')
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Order[];
}

export async function processExchange(reqId: number, giftCode: string): Promise<string> {
  const { data, error } = await supabase.rpc('process_exchange', {
    p_req_id: reqId,
    p_gift_code: giftCode,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? '処理しました';
}

export async function updateShipping(
  orderId: number,
  status: string,
  tracking: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('update_shipping', {
    p_order_id: orderId,
    p_status: status,
    p_tracking: tracking,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? '更新しました';
}

export async function recordPartnerOrder(orderId: number, partnerOrderId: string): Promise<string> {
  const { data, error } = await supabase.rpc('record_partner_order', {
    p_order_id: orderId,
    p_partner_order_id: partnerOrderId,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? '発注を記録しました';
}

export async function uploadImage(userId: string, file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'png';
  const path = `${userId}/img_${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('uploads').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('uploads').getPublicUrl(path);
  return data.publicUrl;
}

// ---------- お知らせ（🔔通知） ----------

export async function fetchAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('is_active', true)
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Announcement[];
}

/** 自分宛の進捗通知（🔔） */
export async function fetchMyNotifications(userId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('id', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Notification[];
}

export async function createAnnouncement(title: string, body: string) {
  const { error } = await supabase.from('announcements').insert({ title, body });
  if (error) throw new Error(error.message);
}

export async function deactivateAnnouncement(id: number) {
  const { error } = await supabase.from('announcements').update({ is_active: false }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 累計売上分配額（確定申告通知の判定用。「売上分配」レコードの合計） */
export async function fetchLifetimeEarnings(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('balance_history')
    .select('amount')
    .eq('user_id', userId)
    .eq('type', '売上分配');
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, r) => sum + ((r as { amount: number }).amount ?? 0), 0);
}

/** 退会（アカウント削除）。profiles 削除で関連データが連鎖削除される */
export async function deleteMyAccount(): Promise<string> {
  const { data, error } = await supabase.rpc('delete_my_account');
  if (error) throw new Error(error.message);
  return (data as string) ?? '退会処理が完了しました';
}

// ---------- マイページ統計 ＆ ほしいものリスト ----------

/** 受け取った評価の件数・平均 ＋ 自分の商品の合計売上高 */
export async function fetchMyStats(): Promise<MyStats> {
  const { data, error } = await supabase.rpc('my_profile_stats');
  if (error) throw new Error(error.message);
  return (data ?? { rating_count: 0, rating_avg: 0, total_sales: 0 }) as MyStats;
}

/** 自分がハートを付けた商品のID一覧 */
export async function fetchMyFavorites(): Promise<number[]> {
  const { data, error } = await supabase.from('idea_favorites').select('idea_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { idea_id: number }).idea_id);
}

/** ハートの付け外し */
export async function setFavorite(ideaId: number, fav: boolean) {
  if (fav) {
    const { error } = await supabase.from('idea_favorites').insert({ idea_id: ideaId });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('idea_favorites').delete().eq('idea_id', ideaId);
    if (error) throw new Error(error.message);
  }
}

// ---------- ギフトコード在庫（交換の自動発行） ----------

/** 自動発行可能なギフト（種類・金額・在庫数）。ユーザー向け表示用 */
export async function fetchAvailableGiftAmounts(): Promise<{ exchange_type: string; amount: number; stock: number }[]> {
  const { data, error } = await supabase.rpc('available_gift_amounts');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as { exchange_type: string; amount: number; stock: number }[];
}

/** 管理者: 在庫コード一括登録（1行1コード） */
export async function addGiftCodes(exchangeType: string, amount: number, codes: string[]) {
  const rows = codes.map((code) => ({ exchange_type: exchangeType, amount, code }));
  const { error } = await supabase.from('gift_code_stock').insert(rows);
  if (error) throw new Error(error.message);
}

/** 管理者: 在庫一覧（使用済み含む） */
export async function fetchGiftStock(): Promise<GiftStock[]> {
  const { data, error } = await supabase
    .from('gift_code_stock')
    .select('*')
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as GiftStock[];
}

/** 管理者: 未使用コードの削除 */
export async function deleteGiftCode(id: number) {
  const { error } = await supabase.from('gift_code_stock').delete().eq('id', id).is('used_by', null);
  if (error) throw new Error(error.message);
}

// ---------- STLファイル管理 ----------

export async function uploadStl(userId: string, file: File): Promise<string> {
  const path = `${userId}/stl_${crypto.randomUUID()}.stl`;
  const { error } = await supabase.storage.from('models').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function setIdeaStl(ideaId: number, path: string): Promise<string> {
  const { data, error } = await supabase.rpc('set_idea_stl', {
    p_idea_id: ideaId,
    p_path: path,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? '設定しました';
}

/** 購入者（またはプランナー・モデラー・管理者）が署名付きURLを取得。権限がなければエラー */
export async function getStlDownloadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('models').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    throw new Error('ダウンロードするにはSTLデータをご購入ください');
  }
  return data.signedUrl;
}
