import { readStorage, writeStorage } from '@/shared/lib/storage';
import { pictures } from '../content/fixtures';

export type ShopProduct = {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  image: string;
  category: string;
  price: number;
  variants: { id: string; label: string; stock: number }[];
};
export type CartItem = { productId: string; variantId: string; quantity: number };
export type OrderDetails = { recipient: string; phone: string; address: string; note: string };
export type ShopOrderItem = {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  image: string;
  unitPrice: number;
  quantity: number;
};
export type ShopOrder = OrderDetails & {
  id: string;
  createdAt: number;
  items: ShopOrderItem[];
  subtotal: number;
  total: number;
};
export type ShopState = { version: 1; cart: CartItem[]; orders: ShopOrder[] };
export const SHOP_KEY = 'shop-state-v1';
export const products: ShopProduct[] = [
  {
    id: 'ceramic-cup',
    name: '晨光陶瓷杯',
    subtitle: '把慢下来的时间，装进一杯热饮',
    description:
      '圆润杯身与温和的哑光釉色，陪伴早晨的咖啡和午后的茶。容量约 320 ml，适合日常饮水。商品、图片与价格为固定演示数据。',
    image: pictures.coffee,
    category: '生活',
    price: 6900,
    variants: [
      { id: 'cream', label: '奶油白 · 320 ml', stock: 12 },
      { id: 'lavender', label: '浅薰衣草 · 320 ml', stock: 8 },
    ],
  },
  {
    id: 'forest-notebook',
    name: '林间风景明信片',
    subtitle: '把森林里的一点安静，寄给朋友',
    description:
      '一套 6 张森林主题明信片，收藏树林与晨雾的细节。展示图片为影像样张；背面留白，可写下日常问候。',
    image: pictures.forest,
    category: '文具',
    price: 2900,
    variants: [
      { id: 'green', label: '森林主题 · 6 张', stock: 20 },
      { id: 'white', label: '晨雾主题 · 6 张', stock: 16 },
    ],
  },
  {
    id: 'city-print',
    name: '城市蓝调艺术微喷',
    subtitle: '为房间留一扇通往远方的窗',
    description:
      '将城市里短暂的蓝调时刻收藏在墙面。演示规格为无框纸质画芯，不含画框。图片用于展示搭配灵感。',
    image: pictures.city,
    category: '影像',
    price: 8900,
    variants: [
      { id: 'a4', label: 'A4 · 无框画芯', stock: 10 },
      { id: 'a3', label: 'A3 · 无框画芯', stock: 6 },
    ],
  },
  {
    id: 'weekend-tote',
    name: '独立书店影像集',
    subtitle: '翻阅街角书店，也翻阅城市日常',
    description:
      '一本关于独立书店的轻量影像集，记录书架、灯光与阅读空间。展示图片为书中影像样张；演示规格为 32 页彩色印刷。',
    image: pictures.book,
    category: '生活',
    price: 4900,
    variants: [
      { id: 'natural', label: '平装版 · 32 页', stock: 18 },
      { id: 'blue', label: '精装版 · 32 页', stock: 12 },
    ],
  },
  {
    id: 'camping-light',
    name: '山野远行摄影画',
    subtitle: '让窗外的山野，也住进房间',
    description:
      '将山野远行时的风景制作成纸质摄影画芯。展示图片为画芯影像样张，适合搭配书桌或阅读角，不包含画框。',
    image: pictures.travel,
    category: '户外',
    price: 15900,
    variants: [
      { id: 'warm', label: '山野样张 · A4', stock: 8 },
      { id: 'olive', label: '山野样张 · A3', stock: 5 },
    ],
  },
  {
    id: 'coast-postcards',
    name: '山海风景明信片',
    subtitle: '把沿途的风景，寄给在意的人',
    description:
      '一套 12 张山海主题明信片，留白背面可写下旅途心情。用于体验商品规格选择与购物车数量操作。',
    image: pictures.sea,
    category: '文具',
    price: 3600,
    variants: [
      { id: 'sea', label: '海岸系列 · 12 张', stock: 25 },
      { id: 'mountain', label: '山野系列 · 12 张', stock: 20 },
    ],
  },
];
export const findProduct = (id: string) => products.find((product) => product.id === id);
export const formatPrice = (cents: number) =>
  `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const emptyShop: ShopState = { version: 1, cart: [], orders: [] };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validQuantity = (value: unknown): value is number =>
  integer(value) && value >= 1 && value <= 99;
const itemKey = (item: Pick<CartItem, 'productId' | 'variantId'>) =>
  `${item.productId}:${item.variantId}`;
const uniqueItems = (items: Pick<CartItem, 'productId' | 'variantId'>[]) =>
  new Set(items.map(itemKey)).size === items.length;
function isCartItem(value: unknown): value is CartItem {
  return (
    record(value) &&
    typeof value.productId === 'string' &&
    !!findProduct(value.productId)?.variants.some((variant) => variant.id === value.variantId) &&
    validQuantity(value.quantity)
  );
}
function isOrder(value: unknown): value is ShopOrder {
  if (
    !record(value) ||
    !text(value.id) ||
    !integer(value.createdAt) ||
    Number.isNaN(new Date(value.createdAt).getTime()) ||
    !text(value.recipient) ||
    value.recipient.trim().length > 50 ||
    !text(value.phone) ||
    !/^1\d{10}$/.test(value.phone.trim()) ||
    !text(value.address) ||
    value.address.trim().length < 6 ||
    value.address.trim().length > 200 ||
    typeof value.note !== 'string' ||
    value.note.length > 200 ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    !integer(value.subtotal) ||
    !integer(value.total)
  )
    return false;
  if (
    !value.items.every((item: unknown) => {
      if (!record(item)) return false;
      const fields = item as Record<string, unknown>;
      return (
        isCartItem(item) &&
        text(fields.name) &&
        text(fields.variantLabel) &&
        typeof fields.image === 'string' &&
        integer(fields.unitPrice) &&
        fields.unitPrice > 0
      );
    })
  )
    return false;
  const items = value.items as ShopOrderItem[];
  return (
    uniqueItems(items) &&
    items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) === value.subtotal &&
    value.subtotal === value.total
  );
}
export function availableStock(state: ShopState, productId: string, variantId: string): number {
  const stock =
    findProduct(productId)?.variants.find((variant) => variant.id === variantId)?.stock ?? 0;
  const purchased = state.orders.reduce(
    (sum, order) =>
      sum +
      order.items
        .filter((item) => item.productId === productId && item.variantId === variantId)
        .reduce((count, item) => count + item.quantity, 0),
    0,
  );
  return Math.max(0, stock - purchased);
}
export function isShopState(value: unknown): value is ShopState {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.cart) ||
    !value.cart.every(isCartItem) ||
    !uniqueItems(value.cart) ||
    !Array.isArray(value.orders) ||
    !value.orders.every(isOrder) ||
    new Set(value.orders.map((order) => order.id)).size !== value.orders.length
  )
    return false;
  const state = value as unknown as ShopState;
  if (
    !state.cart.every(
      (item) => item.quantity <= availableStock(state, item.productId, item.variantId),
    )
  )
    return false;
  return products.every((product) =>
    product.variants.every(
      (variant) =>
        state.orders.reduce(
          (sum, order) =>
            sum +
            order.items
              .filter((item) => item.productId === product.id && item.variantId === variant.id)
              .reduce((count, item) => count + item.quantity, 0),
          0,
        ) <= variant.stock,
    ),
  );
}
export function loadShop(): ShopState {
  return readStorage(SHOP_KEY, emptyShop, isShopState);
}
export function persistShop(state: ShopState): boolean {
  if (!isShopState(state)) throw new Error('商城数据无效，未保存');
  return writeStorage(SHOP_KEY, state);
}
export function cartTotal(state: ShopState): number {
  return state.cart.reduce(
    (sum, item) => sum + (findProduct(item.productId)?.price ?? 0) * item.quantity,
    0,
  );
}
export function cartCount(state: ShopState): number {
  return state.cart.reduce((sum, item) => sum + item.quantity, 0);
}
export function cartSignature(state: ShopState): string {
  return JSON.stringify(
    state.cart
      .map((item) => ({ ...item, price: findProduct(item.productId)?.price }))
      .sort((a, b) => itemKey(a).localeCompare(itemKey(b))),
  );
}
function checkItem(state: ShopState, productId: string, variantId: string, quantity: number) {
  const product = findProduct(productId);
  if (!product) throw new Error('商品不存在');
  if (!product.variants.some((variant) => variant.id === variantId))
    throw new Error('请选择有效规格');
  if (!validQuantity(quantity)) throw new Error('数量须为 1–99 的整数');
  if (quantity > availableStock(state, productId, variantId))
    throw new Error('超出该规格的演示库存');
}
export function addToCart(
  state: ShopState,
  productId: string,
  variantId: string,
  quantity: number,
): ShopState {
  if (!validQuantity(quantity)) throw new Error('数量须为 1–99 的整数');
  const existing = state.cart.find(
    (item) => item.productId === productId && item.variantId === variantId,
  );
  const combined = (existing?.quantity ?? 0) + quantity;
  checkItem(state, productId, variantId, combined);
  return {
    ...state,
    cart: existing
      ? state.cart.map((item) => (item === existing ? { ...item, quantity: combined } : item))
      : [...state.cart, { productId, variantId, quantity }],
  };
}
export function setCartQuantity(
  state: ShopState,
  productId: string,
  variantId: string,
  quantity: number,
): ShopState {
  checkItem(state, productId, variantId, quantity);
  if (!state.cart.some((item) => item.productId === productId && item.variantId === variantId))
    throw new Error('购物车商品不存在');
  return {
    ...state,
    cart: state.cart.map((item) =>
      item.productId === productId && item.variantId === variantId ? { ...item, quantity } : item,
    ),
  };
}
export function removeCartItem(state: ShopState, productId: string, variantId: string): ShopState {
  return {
    ...state,
    cart: state.cart.filter((item) => item.productId !== productId || item.variantId !== variantId),
  };
}
export function restoreCartItem(state: ShopState, item: CartItem): ShopState {
  return addToCart(state, item.productId, item.variantId, item.quantity);
}
export function placeOrder(
  state: ShopState,
  details: OrderDetails,
  requestId: string,
  expectedSignature: string,
  now = Date.now(),
): ShopState {
  if (
    !requestId.trim() ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    Number.isNaN(new Date(now).getTime())
  )
    throw new Error('订单请求无效');
  const id = `order-${requestId}`;
  if (state.orders.some((order) => order.id === id)) return state;
  if (!state.cart.length) throw new Error('购物车为空，请先添加商品');
  if (cartSignature(state) !== expectedSignature)
    throw new Error('购物车已发生变化，请返回购物车重新确认');
  if (!details.recipient.trim() || details.recipient.trim().length > 50)
    throw new Error('请填写有效收件人');
  if (!/^1\d{10}$/.test(details.phone.trim())) throw new Error('请填写 11 位演示手机号');
  if (details.address.trim().length < 6 || details.address.trim().length > 200)
    throw new Error('请填写 6–200 字的演示收货地址');
  if (details.note.length > 200) throw new Error('订单备注不能超过 200 字');
  state.cart.forEach((item) => checkItem(state, item.productId, item.variantId, item.quantity));
  const items = state.cart.map((item) => {
    const product = findProduct(item.productId)!;
    return {
      ...item,
      name: product.name,
      variantLabel: product.variants.find((variant) => variant.id === item.variantId)!.label,
      image: product.image,
      unitPrice: product.price,
    };
  });
  const total = cartTotal(state);
  const order: ShopOrder = {
    id,
    createdAt: now,
    items,
    subtotal: total,
    total,
    recipient: details.recipient.trim(),
    phone: details.phone.trim(),
    address: details.address.trim(),
    note: details.note.trim(),
  };
  return { version: 1, cart: [], orders: [order, ...state.orders] };
}
