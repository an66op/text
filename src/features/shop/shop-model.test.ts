import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHOP_KEY,
  addToCart,
  availableStock,
  cartCount,
  cartSignature,
  cartTotal,
  formatPrice,
  isShopState,
  loadShop,
  persistShop,
  placeOrder,
  products,
  removeCartItem,
  restoreCartItem,
  setCartQuantity,
  type OrderDetails,
} from './shop-model';
const details: OrderDetails = {
  recipient: '演示小林',
  phone: '13800000000',
  address: '演示城市春日路 12 号',
  note: '本地测试',
};
const empty = () => ({ version: 1 as const, cart: [], orders: [] });
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('local shop inventory and order accounting', () => {
  it('merges matching specifications, isolates other variants and calculates all money in integer cents', () => {
    const initial = empty();
    const first = addToCart(initial, 'ceramic-cup', 'cream', 2);
    const second = addToCart(
      addToCart(first, 'ceramic-cup', 'cream', 1),
      'ceramic-cup',
      'lavender',
      1,
    );
    const state = addToCart(second, 'forest-notebook', 'green', 2);
    expect(cartCount(state)).toBe(6);
    expect(state.cart).toHaveLength(3);
    expect(cartTotal(state)).toBe(4 * 6900 + 2 * 2900);
    expect(formatPrice(cartTotal(state))).toBe('¥334.00');
    expect(Number.isInteger(cartTotal(state))).toBe(true);
    expect(initial.cart).toEqual([]);
    expect(isShopState(state)).toBe(true);
  });

  it('rejects invalid products, variants, quantities and amounts over remaining stock without changing the cart', () => {
    const state = addToCart(empty(), 'ceramic-cup', 'cream', 2);
    for (const quantity of [0, -1, NaN, Infinity, 1.5, 100, 13])
      expect(() => setCartQuantity(state, 'ceramic-cup', 'cream', quantity)).toThrow();
    expect(() => addToCart(state, 'ceramic-cup', 'cream', 11)).toThrow('库存');
    expect(() => addToCart(state, 'missing', 'cream', 1)).toThrow('商品不存在');
    expect(() => addToCart(state, 'ceramic-cup', 'missing', 1)).toThrow('规格');
    expect(state.cart[0].quantity).toBe(2);
    expect(() => setCartQuantity(state, 'ceramic-cup', 'lavender', 1)).toThrow('购物车商品不存在');
  });

  it('makes deletion reversible and refuses an undo that would overdraw stock consumed by another simulated order', () => {
    const initial = addToCart(empty(), 'ceramic-cup', 'cream', 2);
    const removed = removeCartItem(initial, 'ceramic-cup', 'cream');
    expect(removed.cart).toEqual([]);
    expect(restoreCartItem(removed, initial.cart[0])).toEqual(initial);
    const allStock = addToCart(removed, 'ceramic-cup', 'cream', 12);
    const ordered = placeOrder(allStock, details, 'stock-used', cartSignature(allStock));
    expect(availableStock(ordered, 'ceramic-cup', 'cream')).toBe(0);
    expect(availableStock(ordered, 'ceramic-cup', 'lavender')).toBe(8);
    expect(() => restoreCartItem(ordered, initial.cart[0])).toThrow('库存');
    expect(() => addToCart(ordered, 'ceramic-cup', 'cream', 1)).toThrow('库存');
  });

  it('atomically snapshots an order and clears its cart while ignoring duplicate submissions', () => {
    const cart = addToCart(
      addToCart(empty(), 'ceramic-cup', 'cream', 2),
      'forest-notebook',
      'green',
      1,
    );
    const ordered = placeOrder(cart, details, 'first', cartSignature(cart), 1_800_000_000_000);
    expect(ordered.cart).toEqual([]);
    expect(ordered.orders[0]).toMatchObject({
      id: 'order-first',
      total: 16700,
      subtotal: 16700,
      ...details,
    });
    expect(ordered.orders[0].items[0]).toMatchObject({
      name: '晨光陶瓷杯',
      variantLabel: '奶油白 · 320 ml',
      quantity: 2,
      unitPrice: 6900,
    });
    expect(availableStock(ordered, 'ceramic-cup', 'cream')).toBe(10);
    expect(placeOrder(ordered, details, 'first', cartSignature(cart))).toBe(ordered);
    expect(isShopState(ordered)).toBe(true);
    const nextCart = addToCart(ordered, 'ceramic-cup', 'cream', 1);
    expect(placeOrder(nextCart, details, 'first', cartSignature(cart))).toBe(nextCart);
    expect(nextCart.cart[0].quantity).toBe(1);
    expect(nextCart.orders).toHaveLength(1);
  });

  it('checks a checkout snapshot, contact fields and empty carts before placing an order', () => {
    const cart = addToCart(empty(), 'ceramic-cup', 'cream', 1);
    const changed = setCartQuantity(cart, 'ceramic-cup', 'cream', 2);
    expect(() => placeOrder(changed, details, 'stale', cartSignature(cart))).toThrow('发生变化');
    expect(() => placeOrder(empty(), details, 'empty', cartSignature(empty()))).toThrow(
      '购物车为空',
    );
    for (const patch of [
      { recipient: '' },
      { phone: '123' },
      { address: '短' },
      { note: '长'.repeat(201) },
    ])
      expect(() =>
        placeOrder(cart, { ...details, ...patch }, 'invalid', cartSignature(cart)),
      ).toThrow();
    expect(cart.orders).toEqual([]);
    expect(cart.cart[0].quantity).toBe(1);
  });

  it('restores a valid single record, rejects corrupt money and inventory, and preserves both sides when storage fails', () => {
    const cart = addToCart(empty(), 'ceramic-cup', 'cream', 2);
    expect(persistShop(cart)).toBe(true);
    expect(loadShop()).toEqual(cart);
    const ordered = placeOrder(cart, details, 'saved', cartSignature(cart));
    expect(persistShop(ordered)).toBe(true);
    expect(loadShop()).toEqual(ordered);
    for (const malformed of [
      null,
      { ...cart, cart: [{ ...cart.cart[0], quantity: 1.5 }] },
      { ...ordered, orders: [{ ...ordered.orders[0], total: ordered.orders[0].total + 1 }] },
      { ...ordered, orders: [ordered.orders[0], ordered.orders[0]] },
      { ...ordered, cart: [{ ...cart.cart[0], quantity: 12 }] },
    ])
      expect(isShopState(malformed)).toBe(false);
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(persistShop(addToCart(ordered, 'ceramic-cup', 'cream', 1))).toBe(false);
    expect(loadShop()).toEqual(ordered);
    setter.mockRestore();
    localStorage.setItem(SHOP_KEY, JSON.stringify({ ...ordered, orders: [null] }));
    expect(loadShop()).toEqual(empty());
    expect(products.length).toBeGreaterThanOrEqual(6);
  });
});
