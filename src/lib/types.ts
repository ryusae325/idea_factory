export type Role = 'プランナー' | 'モデラー' | '購入者' | '運営者';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  balance: number;
  is_admin: boolean;
  created_at: string;
}

export type IdeaStatus = 'アイデア募集' | '制作中' | '販売中';

export interface ProfileLite {
  username: string;
  display_name: string;
}

export interface Comment {
  id: number;
  idea_id: number;
  user_id: string;
  content: string;
  created_at: string;
  author?: ProfileLite;
}

export interface Idea {
  id: number;
  title: string;
  description: string;
  image_url: string;
  images: string[];
  status: IdeaStatus;
  creator_id: string;
  modeler_id: string | null;
  creator_share: number;
  modeler_share: number;
  price_physical: number;
  price_digital: number;
  mfg_cost: number;
  size_tier: 'S' | 'M' | 'L' | 'XL';
  total_sales: number;
  platform_fee: number;
  creator_reward: number;
  modeler_reward: number;
  stl_path: string | null;
  created_at: string;
  creator?: ProfileLite | null;
  modeler?: ProfileLite | null;
}

export interface Order {
  id: number;
  user_id: string;
  idea_id: number;
  item_type: 'physical' | 'digital';
  price: number;
  fulfillment_fee: number;
  shipping_status: string;
  tracking_number: string;
  shipping_name: string;
  shipping_postal: string;
  shipping_address: string;
  shipping_phone: string;
  partner_status: string;
  partner_order_id: string;
  ordered_at: string | null;
  created_at: string;
  idea?: { title: string; stl_path?: string | null } | null;
  buyer?: ProfileLite | null;
}

export interface ExchangeRequest {
  id: number;
  user_id: string;
  exchange_type: string;
  amount: number;
  status: '未処理' | '完了';
  gift_code: string;
  created_at: string;
  requester?: ProfileLite | null;
}

export interface BalanceEntry {
  id: number;
  amount: number;
  type: string;
  expires_at: string | null;
  created_at: string;
}

export const fmtYen = (n: number) => n.toLocaleString('ja-JP');

export const fmtDate = (iso: string) => (iso ? iso.slice(5, 16).replace('T', ' ') : '');
