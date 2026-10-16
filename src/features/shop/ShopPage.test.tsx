import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import ShopPage from './ShopPage';
import { SHOP_KEY, addToCart, loadShop, persistShop } from './shop-model';
function App({ entry = '/shop' }: { entry?: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/shop" element={<ShopPage kind="catalog" />} />
        <Route path="/shop/products/:productId" element={<ShopPage kind="product" />} />
        <Route path="/shop/cart" element={<ShopPage kind="cart" />} />
        <Route path="/shop/checkout" element={<ShopPage kind="checkout" />} />
        <Route path="/shop/orders" element={<ShopPage kind="orders" />} />
        <Route path="/shop/orders/:orderId" element={<ShopPage kind="order" />} />
      </Routes>
    </MemoryRouter>
  );
}
function fillCheckout() {
  fireEvent.change(screen.getByLabelText('收件人'), { target: { value: '演示小林' } });
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800000000' } });
  fireEvent.change(screen.getByLabelText('收货地址'), {
    target: { value: '演示城市春日路 12 号' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('shop browsing and simulated checkout', () => {
  it('filters products, chooses a variant, changes quantity, undoes deletion and generates a persisted simulated order', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '文具' }));
    expect(screen.queryByRole('link', { name: /晨光陶瓷杯/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.change(screen.getByLabelText('搜索商品'), { target: { value: '陶瓷杯' } });
    fireEvent.click(screen.getByRole('link', { name: /晨光陶瓷杯/ }));
    fireEvent.click(screen.getByRole('button', { name: '浅薰衣草 · 320 ml' }));
    fireEvent.click(screen.getByRole('button', { name: '增加购买数量' }));
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }));
    expect(screen.getByRole('status')).toHaveTextContent('已加入购物车');
    fireEvent.click(screen.getByRole('link', { name: '去看看' }));
    expect(screen.getByText('¥138.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除晨光陶瓷杯浅薰衣草 · 320 ml' }));
    expect(screen.getByRole('heading', { name: '购物车还是空的' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销删除' }));
    expect(loadShop().cart[0]).toMatchObject({ variantId: 'lavender', quantity: 2 });
    fireEvent.click(screen.getByRole('link', { name: '确认结算 (2)' }));
    expect(screen.getByRole('button', { name: '提交模拟订单' })).toBeDisabled();
    fillCheckout();
    fireEvent.click(screen.getByRole('button', { name: '提交模拟订单' }));
    expect(screen.getByRole('heading', { name: '模拟订单已生成' })).toBeInTheDocument();
    expect(loadShop().cart).toEqual([]);
    expect(loadShop().orders[0].total).toBe(13800);
    fireEvent.click(screen.getByRole('link', { name: '全部订单' }));
    expect(screen.getByText('合计 ¥138.00')).toBeInTheDocument();
    expect(loadShop().orders).toHaveLength(1);
  });

  it('shows invalid contact information and never shows a successful order or clears the cart when storage fails', () => {
    persistShop(addToCart(loadShop(), 'ceramic-cup', 'cream', 1));
    render(<App entry="/shop/checkout" />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '提交模拟订单' }));
    expect(screen.getByRole('alert')).toHaveTextContent('收件人');
    fireEvent.click(screen.getByRole('checkbox'));
    fillCheckout();
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === SHOP_KEY) throw new DOMException('Full', 'QuotaExceededError');
      originalSet.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('button', { name: '提交模拟订单' }));
    expect(screen.getByRole('alert')).toHaveTextContent('未保存');
    expect(screen.queryByRole('heading', { name: '模拟订单已生成' })).not.toBeInTheDocument();
    expect(loadShop().cart).toHaveLength(1);
    expect(loadShop().orders).toEqual([]);
  });

  it('rejects a stale checkout in a second open view and restores order details after remount', () => {
    persistShop(addToCart(loadShop(), 'ceramic-cup', 'cream', 1));
    const first = render(<App entry="/shop/checkout" />);
    const second = render(<App entry="/shop/checkout" />);
    for (const view of [first, second]) {
      const scope = within(view.container);
      fireEvent.change(scope.getByLabelText('收件人'), { target: { value: '演示小林' } });
      fireEvent.change(scope.getByLabelText('手机号'), { target: { value: '13800000000' } });
      fireEvent.change(scope.getByLabelText('收货地址'), {
        target: { value: '演示城市春日路 12 号' },
      });
      fireEvent.click(scope.getByRole('checkbox'));
    }
    fireEvent.click(within(first.container).getByRole('button', { name: '提交模拟订单' }));
    expect(within(second.container).getByRole('button', { name: '提交模拟订单' })).toBeDisabled();
    expect(within(second.container).getByRole('alert')).toHaveTextContent('购物车已发生变化');
    const orderId = loadShop().orders[0].id;
    first.unmount();
    second.unmount();
    render(<App entry={`/shop/orders/${orderId}`} />);
    expect(screen.getByText(orderId)).toBeInTheDocument();
    expect(screen.getByText('演示城市春日路 12 号')).toBeInTheDocument();
    expect(loadShop().orders).toHaveLength(1);
  });

  it('keeps invalid purchase quantities out of storage and safely handles unknown product/order URLs', () => {
    const first = render(<App entry="/shop/products/ceramic-cup" />);
    fireEvent.change(screen.getByLabelText('购买数量'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }));
    expect(screen.getByRole('alert')).toHaveTextContent('整数');
    expect(loadShop().cart).toEqual([]);
    first.unmount();
    const missing = render(<App entry="/shop/products/missing" />);
    expect(screen.getByRole('heading', { name: '未找到这件商品' })).toBeInTheDocument();
    missing.unmount();
    render(<App entry="/shop/orders/missing" />);
    expect(screen.getByRole('heading', { name: '未找到这笔模拟订单' })).toBeInTheDocument();
  });
});
