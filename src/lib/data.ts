import { supabase, authFetch } from './supabase';
import type { Comment, ExchangeRequest, Idea, Order, BalanceEntry, Profile } from './types';

export const IDEA_SELECT = `*, creator:profiles!ideas_creator_id_fkey(username,display_name), modeler:profiles!ideas_modeler_id_fkey(username,display_name)`;

export async function fetchIdeas(): Promise<Idea[]> {
  const { data, error } = await supabase
    .from('ideas')
    .select(IDEA_SELECT)
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Idea[];
}

export async function fetchIdea(id: number): Promise<Idea | null> {
  const { data, error } = await supabase
    .from('ideas')
    .select(IDEA_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Idea) ?? null;
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
  image_url: string;
  creator_id: string;
  creator_share: number;
  modeler_share: number;
  price_physical: number;
  price_digital: number;
  mfg_cost: number;
}) {
  const { error } = await supabase.from('ideas').insert(values);
  if (error) throw new Error(error.message);
}

export async function deleteIdea(id: number) {
  const { error } = await supabase.from('ideas').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateIdeaStatus(id: number, status: '制作中' | '販売中'): Promise<string> {
  const { data, error } = await supabase.rpc('update_idea_status', {
    p_idea_id: id,
    p_new_status: status,
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
  values: { display_name: string; role: Profile['role'] },
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
