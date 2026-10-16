import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import {
  addToCart,
  availableStock,
  cartCount,
  cartSignature,
  cartTotal,
  findProduct,
  formatPrice,
  placeOrder,
  products,
  removeCartItem,
  restoreCartItem,
  setCartQuantity,
  type CartItem,
  type OrderDetails,
  type ShopOrderItem,
  type ShopState,
} from './shop-model';
import { useShop } from './useShop';

type ShopData = ReturnType<typeof useShop>;
const message = (caught: unknown) =>
  caught instanceof Error ? caught.message : '操作未完成，请重试';
const time = (createdAt: number) =>
  new Date(createdAt).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
function ShopNav({ active, state }: { active: 'catalog' | 'cart' | 'orders'; state: ShopState }) {
  return (
    <nav className="shop-nav" aria-label="商城导航">
      <Link
        aria-current={active === 'catalog' ? 'page' : undefined}
        className={active === 'catalog' ? 'active' : ''}
        to="/shop"
      >
        好物
      </Link>
      <Link
        aria-current={active === 'cart' ? 'page' : undefined}
        className={active === 'cart' ? 'active' : ''}
        to="/shop/cart"
      >
        购物{cartCount(state) > 0 && <b>{cartCount(state)}</b>}
      </Link>
      <Link
        aria-current={active === 'orders' ? 'page' : undefined}
        className={active === 'orders' ? 'active' : ''}
        to="/shop/orders"
      >
        订单
      </Link>
    </nav>
  );
}
function DemoNote() {
  return (
    <p className="shop-demo-note">
      商品价格与库存为固定演示数据；提交仅生成本地模拟订单，不支付、不安排配送。
    </p>
  );
}
function Missing({ title }: { title: string }) {
  return (
    <div className="shop-empty">
      <Package size={39} />
      <h2>{title}</h2>
      <p>返回商城，看看其他日常好物。</p>
      <Link className="primary" to="/shop">
        逛逛商城
      </Link>
    </div>
  );
}
function Catalog({ state }: ShopData) {
  const [category, setCategory] = useState('全部');
  const [query, setQuery] = useState('');
  const categories = ['全部', ...new Set(products.map((product) => product.category))];
  const found = products.filter(
    (product) =>
      (category === '全部' || product.category === category) &&
      `${product.name} ${product.subtitle} ${product.category}`.includes(query.trim()),
  );
  return (
    <>
      <ShopNav active="catalog" state={state} />
      <section className="shop-hero">
        <img src={products[0].image} alt="咖啡与日常生活灵感" />
        <div>
          <span>共鸣好物 · 日常精选</span>
          <h1>
            把喜欢，
            <br />
            带进生活。
          </h1>
          <p>器物、纸张与沿途的风景</p>
          <a href="#shop-products">
            发现好物 <ArrowUpRight size={15} />
          </a>
        </div>
        <span className="shop-hero-pill">本地模拟商城</span>
      </section>
      <label className="shop-search">
        <Search size={18} />
        <input
          aria-label="搜索商品"
          placeholder="搜索你喜欢的好物"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="shop-categories" aria-label="商品分类">
        {categories.map((value) => (
          <button
            key={value}
            className={category === value ? 'active' : ''}
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="shop-section-title" id="shop-products">
        <h2>{query.trim() ? '搜索结果' : category === '全部' ? '精选好物' : `${category}好物`}</h2>
        <span>{found.length} 件商品</span>
      </div>
      <div className="shop-product-grid">
        {found.map((product) => (
          <Link className="shop-product-card" key={product.id} to={`/shop/products/${product.id}`}>
            <div className="shop-product-image">
              <img loading="lazy" src={product.image} alt={product.name} />
              <span>{product.category}</span>
            </div>
            <div className="shop-product-copy">
              <h3>{product.name}</h3>
              <p>{product.subtitle}</p>
              <div>
                <strong>{formatPrice(product.price)}</strong>
                <span>
                  查看 <ChevronRight size={13} />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!found.length && (
        <div className="shop-empty">
          <Search size={34} />
          <h2>没有找到这件好物</h2>
          <p>试试“杯”“风景”或切换分类。</p>
          <button
            className="shop-outline"
            onClick={() => {
              setQuery('');
              setCategory('全部');
            }}
          >
            重置筛选
          </button>
        </div>
      )}
      <DemoNote />
    </>
  );
}
function Product({ state, commit, productId }: ShopData & { productId: string }) {
  const product = findProduct(productId);
  const [variantId, setVariantId] = useState(product?.variants[0].id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const saving = useRef(false);
  if (!product) return <Missing title="未找到这件商品" />;
  const variant = product.variants.find((item) => item.id === variantId)!;
  const stock = availableStock(state, productId, variantId);
  const inCart =
    state.cart.find((item) => item.productId === productId && item.variantId === variantId)
      ?.quantity ?? 0;
  const maximum = Math.min(99, stock - inCart);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    try {
      commit((current) => addToCart(current, productId, variantId, quantity));
      setSuccess(true);
      setError('');
    } catch (caught) {
      setError(message(caught));
      setSuccess(false);
    } finally {
      saving.current = false;
    }
  };
  return (
    <>
      <div className="shop-detail-image">
        <img src={product.image} alt={product.name} />
        <span>{product.category}精选</span>
      </div>
      <form className="shop-product-detail" onSubmit={submit} noValidate>
        <div className="shop-detail-title">
          <span>{product.subtitle}</span>
          <h1>{product.name}</h1>
          <strong>{formatPrice(product.price)}</strong>
        </div>
        <fieldset className="shop-variants">
          <legend>选择规格</legend>
          {product.variants.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={variantId === option.id}
              className={variantId === option.id ? 'active' : ''}
              onClick={() => {
                setVariantId(option.id);
                setQuantity(1);
                setError('');
                setSuccess(false);
              }}
            >
              {option.label}
              {variantId === option.id && <Check size={13} />}
            </button>
          ))}
        </fieldset>
        <div className="shop-quantity-row">
          <div>
            <strong>购买数量</strong>
            <small>
              演示库存 {stock} 件{inCart > 0 ? ` · 已在购物车 ${inCart} 件` : ''}
            </small>
          </div>
          <div className="shop-stepper">
            <button
              type="button"
              aria-label="减少购买数量"
              disabled={quantity <= 1}
              onClick={() => {
                setQuantity((value) => value - 1);
                setSuccess(false);
              }}
            >
              <Minus size={15} />
            </button>
            <input
              aria-label="购买数量"
              inputMode="numeric"
              value={Number.isNaN(quantity) ? '' : quantity}
              onChange={(event) => {
                setQuantity(event.target.value === '' ? NaN : Number(event.target.value));
                setError('');
                setSuccess(false);
              }}
            />
            <button
              type="button"
              aria-label="增加购买数量"
              disabled={quantity >= maximum}
              onClick={() => {
                setQuantity((value) => (Number.isFinite(value) ? value + 1 : 1));
                setSuccess(false);
              }}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        <section className="shop-description">
          <h2>关于这件好物</h2>
          <p>{product.description}</p>
          <dl>
            <div>
              <dt>所选规格</dt>
              <dd>{variant.label}</dd>
            </div>
            <div>
              <dt>配送说明</dt>
              <dd>仅模拟下单，无实际配送</dd>
            </div>
          </dl>
        </section>
        {error && (
          <p className="shop-error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="shop-success" role="status">
            <CheckCircle2 size={16} />
            已加入购物车{' '}
            <Link to="/shop/cart">
              去看看 <ChevronRight size={13} />
            </Link>
          </p>
        )}
        <div className="shop-product-actions">
          <Link className="shop-outline" to="/shop/cart">
            <ShoppingCart size={19} />
            <span>购物{cartCount(state) > 0 ? ` (${cartCount(state)})` : ''}</span>
          </Link>
          <button className="primary" disabled={maximum <= 0}>
            {maximum <= 0 ? (stock <= 0 ? '该规格已售罄' : '库存已全部在购物车') : '加入购物车'}
          </button>
        </div>
      </form>
      <DemoNote />
    </>
  );
}
function Cart({ state, commit }: ShopData) {
  const [removed, setRemoved] = useState<CartItem[]>([]);
  const [error, setError] = useState('');
  const change = (item: CartItem, quantity: number) => {
    try {
      commit((current) => setCartQuantity(current, item.productId, item.variantId, quantity));
      setError('');
    } catch (caught) {
      setError(message(caught));
    }
  };
  const remove = (item: CartItem) => {
    try {
      commit((current) => removeCartItem(current, item.productId, item.variantId));
      setRemoved((items) => [...items, item]);
      setError('');
    } catch (caught) {
      setError(message(caught));
    }
  };
  const undo = () => {
    const last = removed.at(-1);
    if (!last) return;
    try {
      commit((current) => restoreCartItem(current, last));
      setRemoved((items) => items.slice(0, -1));
      setError('');
    } catch (caught) {
      setError(message(caught));
    }
  };
  return (
    <>
      <ShopNav active="cart" state={state} />
      {removed.length > 0 && (
        <div className="shop-undo" role="status">
          <span>已移除 {findProduct(removed.at(-1)!.productId)?.name}</span>
          <button onClick={undo}>撤销删除</button>
        </div>
      )}
      {error && (
        <p className="shop-error" role="alert">
          {error}
        </p>
      )}
      {state.cart.length ? (
        <>
          <div className="shop-section-title">
            <h1>购物车</h1>
            <span>{cartCount(state)} 件好物</span>
          </div>
          <div className="shop-cart-list">
            {state.cart.map((item) => {
              const product = findProduct(item.productId)!;
              const variant = product.variants.find((value) => value.id === item.variantId)!;
              return (
                <article className="shop-cart-item" key={`${item.productId}:${item.variantId}`}>
                  <Link to={`/shop/products/${product.id}`}>
                    <img src={product.image} alt={product.name} />
                  </Link>
                  <div>
                    <Link className="shop-cart-name" to={`/shop/products/${product.id}`}>
                      {product.name}
                    </Link>
                    <small>{variant.label}</small>
                    <strong>{formatPrice(product.price)}</strong>
                    <div className="shop-cart-item-controls">
                      <div className="shop-stepper">
                        <button
                          aria-label={`减少${product.name}${variant.label}数量`}
                          disabled={item.quantity <= 1}
                          onClick={() => change(item, item.quantity - 1)}
                        >
                          <Minus size={13} />
                        </button>
                        <output aria-label={`${product.name}${variant.label}数量`}>
                          {item.quantity}
                        </output>
                        <button
                          aria-label={`增加${product.name}${variant.label}数量`}
                          disabled={
                            item.quantity >=
                            Math.min(99, availableStock(state, item.productId, item.variantId))
                          }
                          onClick={() => change(item, item.quantity + 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <button
                        className="shop-remove"
                        aria-label={`移除${product.name}${variant.label}`}
                        onClick={() => remove(item)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="shop-cart-summary">
            <span>
              商品合计 <strong>{formatPrice(cartTotal(state))}</strong>
            </span>
            <small>模拟免运费 · 无实际支付</small>
            <Link className="primary" to="/shop/checkout">
              确认结算 ({cartCount(state)}) <ChevronRight size={16} />
            </Link>
          </div>
        </>
      ) : (
        <div className="shop-empty">
          <ShoppingBag size={43} />
          <h2>购物车还是空的</h2>
          <p>把喜欢的日常好物，先放进这里。</p>
          <Link className="primary" to="/shop">
            去挑选好物
          </Link>
        </div>
      )}
      <DemoNote />
    </>
  );
}
function ItemSummary({ items }: { items: ShopOrderItem[] }) {
  return (
    <div className="shop-order-items">
      {items.map((item) => (
        <div key={`${item.productId}:${item.variantId}`}>
          <img src={item.image} alt={item.name} />
          <span>
            <strong>{item.name}</strong>
            <small>{item.variantLabel}</small>
            <b>{formatPrice(item.unitPrice)}</b>
          </span>
          <em>×{item.quantity}</em>
        </div>
      ))}
    </div>
  );
}
function snapshotItems(state: ShopState): ShopOrderItem[] {
  return state.cart.map((item) => {
    const product = findProduct(item.productId)!;
    return {
      ...item,
      name: product.name,
      variantLabel: product.variants.find((variant) => variant.id === item.variantId)!.label,
      image: product.image,
      unitPrice: product.price,
    };
  });
}
function Checkout({ state, commit }: ShopData) {
  const [snapshot] = useState(() => state);
  const [signature] = useState(() => cartSignature(state));
  const [requestId] = useState(() => crypto.randomUUID());
  const [details, setDetails] = useState<OrderDetails>({
    recipient: '',
    phone: '',
    address: '',
    note: '',
  });
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const submitting = useRef(false);
  const navigate = useNavigate();
  const changed = signature !== cartSignature(state);
  if (!snapshot.cart.length) return <Missing title="购物车为空，暂不能结算" />;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!accepted) {
      setError('请先确认模拟订单说明');
      return;
    }
    submitting.current = true;
    try {
      const next = commit((current) => placeOrder(current, details, requestId, signature));
      const order = next.orders.find((item) => item.id === `order-${requestId}`);
      if (!order) throw new Error('订单未保存，请重试');
      navigate(`/shop/orders/${order.id}?created=1`, { replace: true });
    } catch (caught) {
      setError(message(caught));
      submitting.current = false;
    }
  };
  const field = (key: keyof OrderDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }));
    setError('');
  };
  return (
    <form onSubmit={submit} className="shop-checkout" noValidate>
      <div className="shop-checkout-note">
        <ShoppingBag size={19} />
        <span>这是一次模拟结算，不会发起支付或安排配送。请使用演示联系信息。</span>
      </div>
      <section className="shop-checkout-address">
        <h1>确认收货信息</h1>
        <label>
          收件人
          <input
            aria-label="收件人"
            placeholder="填写演示姓名"
            maxLength={50}
            value={details.recipient}
            onChange={(event) => field('recipient', event.target.value)}
          />
        </label>
        <label>
          手机号
          <input
            aria-label="手机号"
            type="tel"
            inputMode="numeric"
            placeholder="如 13800000000（仅本地保存）"
            maxLength={11}
            value={details.phone}
            onChange={(event) => field('phone', event.target.value)}
          />
        </label>
        <label>
          收货地址
          <textarea
            aria-label="收货地址"
            placeholder="填写演示城市、街道与门牌"
            maxLength={200}
            value={details.address}
            onChange={(event) => field('address', event.target.value)}
          />
        </label>
      </section>
      <section className="shop-checkout-products">
        <h2>确认商品</h2>
        <ItemSummary items={snapshotItems(snapshot)} />
      </section>
      <label className="shop-checkout-remark">
        订单备注（选填）
        <input
          aria-label="订单备注"
          placeholder="最多 200 字"
          maxLength={200}
          value={details.note}
          onChange={(event) => field('note', event.target.value)}
        />
      </label>
      <dl className="shop-costs">
        <div>
          <dt>商品金额</dt>
          <dd>{formatPrice(cartTotal(snapshot))}</dd>
        </div>
        <div>
          <dt>模拟运费</dt>
          <dd>¥0.00</dd>
        </div>
        <div>
          <dt>订单合计</dt>
          <dd>{formatPrice(cartTotal(snapshot))}</dd>
        </div>
      </dl>
      <label className="shop-checkout-consent">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => {
            setAccepted(event.target.checked);
            setError('');
          }}
        />
        <span>我了解这是本地模拟订单，无真实支付或配送。</span>
      </label>
      {changed && (
        <p className="shop-error" role="alert">
          购物车已发生变化，请<Link to="/shop/cart">返回购物车重新确认</Link>。
        </p>
      )}
      {error && (
        <p className="shop-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary shop-place-order" disabled={!accepted || changed}>
        提交模拟订单
      </button>
    </form>
  );
}
function Orders({ state }: ShopData) {
  return (
    <>
      <ShopNav active="orders" state={state} />
      <div className="shop-section-title">
        <h1>我的订单</h1>
        <span>{state.orders.length} 笔模拟订单</span>
      </div>
      {state.orders.length ? (
        <div className="shop-orders-list">
          {state.orders.map((order) => (
            <Link className="shop-order-card" to={`/shop/orders/${order.id}`} key={order.id}>
              <div>
                <span>{time(order.createdAt)}</span>
                <b>模拟订单</b>
              </div>
              <ItemSummary items={order.items} />
              <footer>
                <span>共 {order.items.reduce((sum, item) => sum + item.quantity, 0)} 件</span>
                <strong>合计 {formatPrice(order.total)}</strong>
                <ChevronRight size={15} />
              </footer>
            </Link>
          ))}
        </div>
      ) : (
        <div className="shop-empty">
          <Package size={43} />
          <h2>还没有模拟订单</h2>
          <p>挑选好物并完成模拟结算后，可在这里查看记录。</p>
          <Link className="primary" to="/shop">
            去逛逛商城
          </Link>
        </div>
      )}
      <DemoNote />
    </>
  );
}
function Order({ state, orderId }: ShopData & { orderId: string }) {
  const [params] = useSearchParams();
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return <Missing title="未找到这笔模拟订单" />;
  return (
    <>
      <section className="shop-order-result">
        <CheckCircle2 size={43} />
        <span>本地模拟订单</span>
        <h1>{params.get('created') === '1' ? '模拟订单已生成' : '订单详情'}</h1>
        <p>记录已保存在这台设备，无实际支付与配送。</p>
      </section>
      <section className="shop-order-section">
        <h2>商品清单</h2>
        <ItemSummary items={order.items} />
        <dl className="shop-costs">
          <div>
            <dt>商品金额</dt>
            <dd>{formatPrice(order.subtotal)}</dd>
          </div>
          <div>
            <dt>模拟运费</dt>
            <dd>¥0.00</dd>
          </div>
          <div>
            <dt>订单合计</dt>
            <dd>{formatPrice(order.total)}</dd>
          </div>
        </dl>
      </section>
      <section className="shop-order-section">
        <h2>演示收货信息</h2>
        <strong className="shop-recipient">
          {order.recipient} <span>{order.phone}</span>
        </strong>
        <p className="shop-address">{order.address}</p>
        {order.note && <p className="shop-address">备注：{order.note}</p>}
      </section>
      <dl className="shop-order-info">
        <div>
          <dt>订单编号</dt>
          <dd>{order.id}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{time(order.createdAt)}</dd>
        </div>
        <div>
          <dt>支付方式</dt>
          <dd>无 · 仅模拟生成订单</dd>
        </div>
      </dl>
      <div className="shop-order-actions">
        <Link className="shop-outline" to="/shop/orders">
          全部订单
        </Link>
        <Link className="primary" to="/shop">
          继续逛逛
        </Link>
      </div>
    </>
  );
}
export default function ShopPage({
  kind,
}: {
  kind: 'catalog' | 'product' | 'cart' | 'checkout' | 'orders' | 'order';
}) {
  const shop = useShop();
  const { productId = '', orderId = '' } = useParams();
  const title = {
    catalog: '商城',
    product: '商品详情',
    cart: '购物车',
    checkout: '确认订单',
    orders: '我的订单',
    order: '订单详情',
  }[kind];
  return (
    <div className={`shop-page shop-${kind}-page`}>
      <PageHeader
        title={title}
        backTo={
          kind === 'catalog'
            ? '/discover'
            : kind === 'checkout'
              ? '/shop/cart'
              : kind === 'order'
                ? '/shop/orders'
                : '/shop'
        }
        action={
          kind === 'product' ? (
            <Link
              className="shop-header-cart"
              to="/shop/cart"
              aria-label={`购物车 ${cartCount(shop.state)} 件`}
            >
              <ShoppingCart size={21} />
              {cartCount(shop.state) > 0 && <b>{cartCount(shop.state)}</b>}
            </Link>
          ) : undefined
        }
      />
      <div className="shop-content">
        {kind === 'catalog' ? (
          <Catalog {...shop} />
        ) : kind === 'product' ? (
          <Product key={productId} {...shop} productId={productId} />
        ) : kind === 'cart' ? (
          <Cart {...shop} />
        ) : kind === 'checkout' ? (
          <Checkout {...shop} />
        ) : kind === 'orders' ? (
          <Orders {...shop} />
        ) : (
          <Order {...shop} orderId={orderId} />
        )}
      </div>
    </div>
  );
}
