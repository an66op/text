import { isStringArray, readStorage, writeStorage } from '@/shared/lib/storage';

export type Coin = 'ETH' | 'BTC' | 'USDC';
export type TransactionKind =
  'transfer' | 'receive' | 'exchange' | 'legacy' | 'earn-subscribe' | 'earn-redeem';
export type WalletTransaction = {
  id: string;
  kind: TransactionKind;
  coin: Coin;
  amount: number;
  createdAt: string;
  recipient?: string;
  note?: string;
  receiveCoin?: Coin;
  receiveAmount?: number;
  legacyLabel?: string;
  productId?: string;
  positionId?: string;
};
export type WalletState = {
  version: 2;
  balances: Record<Coin, number>;
  transactions: WalletTransaction[];
  earnPositions?: EarnPosition[];
};
export type EarnProduct = {
  id: string;
  coin: Coin;
  name: string;
  term: 'flexible' | 'locked';
  days: number;
  apr: number;
  minimum: number;
  description: string;
};
export type EarnPosition = {
  id: string;
  productId: string;
  coin: Coin;
  principal: number;
  apr: number;
  days: number;
  openedAt: number;
  unlockAt: number;
  status: 'active' | 'redeemed';
  redeemedAt?: number;
};
export const earnProducts: EarnProduct[] = [
  {
    id: 'usdc-flexible',
    coin: 'USDC',
    name: 'USDC 活期',
    term: 'flexible',
    days: 0,
    apr: 3.6,
    minimum: 10,
    description: '灵活安排闲置演示资产，体验随时申购与赎回。',
  },
  {
    id: 'eth-7d',
    coin: 'ETH',
    name: 'ETH 7 天定期',
    term: 'locked',
    days: 7,
    apr: 2.8,
    minimum: 0.01,
    description: '体验固定期限持有，到期后可手动赎回。',
  },
  {
    id: 'btc-30d',
    coin: 'BTC',
    name: 'BTC 30 天定期',
    term: 'locked',
    days: 30,
    apr: 4.2,
    minimum: 0.001,
    description: '用长期持有计划，了解期限与申赎的关系。',
  },
];
export const findEarnProduct = (id: string) => earnProducts.find((product) => product.id === id);
export const DAY_MS = 86_400_000;
export type TransferDraft = {
  coin: Coin;
  amount: string;
  recipient: string;
  note: string;
  requestId?: string;
};

export const WALLET_KEY = 'wallet-v2';
export const DRAFT_KEY = 'wallet-transfer-draft';
export const demoAddress = 'DEMO:0x8a7fC83e679B72EA0512Da113c67b489E500A12B';
export const coins: Coin[] = ['ETH', 'BTC', 'USDC'];
export const coinInfo: Record<
  Coin,
  { name: string; symbol: string; price: number; decimals: number; network: string }
> = {
  ETH: { name: 'Ethereum', symbol: 'Ξ', price: 3300, decimals: 8, network: 'Ethereum 演示网络' },
  BTC: { name: 'Bitcoin', symbol: '₿', price: 60000, decimals: 8, network: 'Bitcoin 演示网络' },
  USDC: { name: 'USD Coin', symbol: '$', price: 1, decimals: 2, network: 'Ethereum 演示网络' },
};
export const isCoin = (value: unknown): value is Coin => coins.includes(value as Coin);
const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const isDraft = (value: unknown): value is TransferDraft => {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<TransferDraft>;
  return (
    isCoin(draft.coin) &&
    typeof draft.amount === 'string' &&
    typeof draft.recipient === 'string' &&
    typeof draft.note === 'string' &&
    (draft.requestId === undefined ||
      (typeof draft.requestId === 'string' && draft.requestId.length > 0))
  );
};
export const isWalletState = (value: unknown): value is WalletState => {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<WalletState>;
  return (
    state.version === 2 &&
    typeof state.balances === 'object' &&
    state.balances !== null &&
    coins.every((coin) => isAmount(state.balances?.[coin])) &&
    Array.isArray(state.transactions) &&
    (state.earnPositions === undefined ||
      (Array.isArray(state.earnPositions) &&
        state.earnPositions.every(isEarnPosition) &&
        new Set(state.earnPositions.map((position) => position.id)).size ===
          state.earnPositions.length)) &&
    state.transactions.every(
      (transaction) =>
        typeof transaction === 'object' &&
        transaction !== null &&
        typeof transaction.id === 'string' &&
        ['transfer', 'receive', 'exchange', 'legacy', 'earn-subscribe', 'earn-redeem'].includes(
          transaction.kind,
        ) &&
        isCoin(transaction.coin) &&
        isAmount(transaction.amount) &&
        typeof transaction.createdAt === 'string' &&
        !Number.isNaN(Date.parse(transaction.createdAt)) &&
        (transaction.receiveCoin === undefined || isCoin(transaction.receiveCoin)) &&
        (transaction.receiveAmount === undefined || isAmount(transaction.receiveAmount)) &&
        (!transaction.kind.startsWith('earn-') ||
          (typeof transaction.productId === 'string' &&
            !!findEarnProduct(transaction.productId) &&
            typeof transaction.positionId === 'string' &&
            !!transaction.positionId)),
    )
  );
};

export function walletTotal(state: WalletState) {
  return coins.reduce(
    (total, coin) =>
      total + (state.balances[coin] + earnPrincipal(state, coin)) * coinInfo[coin].price,
    0,
  );
}
export function quantity(value: number, coin: Coin) {
  return value.toLocaleString('en-US', { maximumFractionDigits: coinInfo[coin].decimals });
}
export function money(value: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function roundCoin(value: number, coin: Coin) {
  return Math.round(value * 10 ** coinInfo[coin].decimals) / 10 ** coinInfo[coin].decimals;
}

export function migrateWallet(): WalletState {
  const legacyBalance = readStorage('balance', 12480.5, isAmount);
  const factor = legacyBalance / 12480.5;
  const legacy = readStorage(
    'transactions',
    ['收到 0.025 ETH · 今天 10:24', '转出 12 USDC · 昨天 18:30'],
    isStringArray,
  );
  return {
    version: 2,
    balances: { ETH: 0.85 * factor, BTC: 0.12 * factor, USDC: 2475.5 * factor },
    transactions: legacy.map((label, index) => ({
      id: `legacy-${index}`,
      kind: 'legacy',
      coin: label.includes('ETH') ? 'ETH' : label.includes('BTC') ? 'BTC' : 'USDC',
      amount: Number(label.match(/\d+(\.\d+)?/)?.[0] ?? 0),
      createdAt: new Date(Date.now() - (index + 1) * 86400000).toISOString(),
      legacyLabel: label,
    })),
  };
}
export function loadWallet() {
  return readStorage(WALLET_KEY, migrateWallet(), isWalletState);
}
export function persistWallet(state: WalletState) {
  if (!writeStorage(WALLET_KEY, state)) return false;
  // wallet-v2 is the single financial record. Legacy mirrors are best effort only.
  try {
    localStorage.setItem('balance', JSON.stringify(Math.round(walletTotal(state) * 100) / 100));
    localStorage.setItem('transactions', JSON.stringify(state.transactions.map(transactionLabel)));
  } catch {
    /* A mirror failure cannot undo a committed wallet-v2 transaction. */
  }
  return true;
}
export function transactionLabel(transaction: WalletTransaction) {
  if (transaction.legacyLabel) return transaction.legacyLabel;
  if (transaction.kind === 'earn-subscribe' || transaction.kind === 'earn-redeem')
    return `${transaction.kind === 'earn-subscribe' ? '理财申购' : '理财赎回'} ${quantity(transaction.amount, transaction.coin)} ${transaction.coin}`;
  if (transaction.kind === 'exchange')
    return `兑换 ${quantity(transaction.amount, transaction.coin)} ${transaction.coin} → ${quantity(transaction.receiveAmount ?? 0, transaction.receiveCoin ?? 'USDC')} ${transaction.receiveCoin}`;
  return `${transaction.kind === 'receive' ? '收到' : '转出'} ${quantity(transaction.amount, transaction.coin)} ${transaction.coin}`;
}
export function validateTransfer(draft: TransferDraft, state: WalletState): string | null {
  const amount = Number(draft.amount);
  if (!draft.recipient.trim()) return '请填写接收方演示地址';
  if (draft.recipient.trim().length < 6) return '接收方地址至少需要 6 个字符';
  if (draft.recipient.trim() === demoAddress) return '请选择其他接收方，不能向自己转账';
  if (!Number.isFinite(amount) || amount <= 0) return '请输入大于 0 的有效数量';
  if (roundCoin(amount, draft.coin) !== amount)
    return `${draft.coin} 最多支持 ${coinInfo[draft.coin].decimals} 位小数`;
  if (amount > state.balances[draft.coin]) return `${draft.coin} 余额不足，请修改数量或币种`;
  return null;
}
export function transfer(state: WalletState, draft: TransferDraft, id: string): WalletState {
  if (state.transactions.some((transaction) => transaction.id === id)) return state;
  const error = validateTransfer(draft, state);
  if (error) throw new Error(error);
  const amount = Number(draft.amount);
  return {
    ...state,
    balances: {
      ...state.balances,
      [draft.coin]: Math.max(0, roundCoin(state.balances[draft.coin] - amount, draft.coin)),
    },
    transactions: [
      {
        id,
        kind: 'transfer',
        coin: draft.coin,
        amount,
        recipient: draft.recipient.trim(),
        note: draft.note.trim(),
        createdAt: new Date().toISOString(),
      },
      ...state.transactions,
    ],
  };
}
export function exchange(
  state: WalletState,
  from: Coin,
  to: Coin,
  amount: number,
  id: string,
): WalletState {
  if (state.transactions.some((transaction) => transaction.id === id)) return state;
  if (from === to) throw new Error('请选择两种不同的资产');
  if (!Number.isFinite(amount) || amount <= 0 || roundCoin(amount, from) !== amount)
    throw new Error('请输入有效的兑换数量');
  if (amount > state.balances[from]) throw new Error(`${from} 余额不足`);
  const receiveAmount = roundCoin((amount * coinInfo[from].price) / coinInfo[to].price, to);
  if (receiveAmount <= 0) throw new Error('数量太少，无法兑换目标资产，请增加数量');
  return {
    ...state,
    balances: {
      ...state.balances,
      [from]: Math.max(0, roundCoin(state.balances[from] - amount, from)),
      [to]: roundCoin(state.balances[to] + receiveAmount, to),
    },
    transactions: [
      {
        id,
        kind: 'exchange',
        coin: from,
        amount,
        receiveCoin: to,
        receiveAmount,
        createdAt: new Date().toISOString(),
      },
      ...state.transactions,
    ],
  };
}
export function addDemoReceipt(state: WalletState, coin: Coin, id: string): WalletState {
  if (state.transactions.some((transaction) => transaction.id === id)) return state;
  const amount = coin === 'USDC' ? 25 : coin === 'ETH' ? 0.01 : 0.0005;
  return {
    ...state,
    balances: { ...state.balances, [coin]: roundCoin(state.balances[coin] + amount, coin) },
    transactions: [
      {
        id,
        kind: 'receive',
        coin,
        amount,
        recipient: demoAddress,
        note: '本地测试收款，仅用于体验',
        createdAt: new Date().toISOString(),
      },
      ...state.transactions,
    ],
  };
}

function isEarnPosition(value: unknown): value is EarnPosition {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<EarnPosition>;
  const product =
    typeof position.productId === 'string' ? findEarnProduct(position.productId) : undefined;
  if (
    !product ||
    !isCoin(position.coin) ||
    product.coin !== position.coin ||
    typeof position.id !== 'string' ||
    !position.id.trim()
  )
    return false;
  if (
    !isAmount(position.principal) ||
    position.principal === 0 ||
    roundCoin(position.principal, position.coin) !== position.principal ||
    !Number.isSafeInteger(Math.round(position.principal * 10 ** coinInfo[position.coin].decimals))
  )
    return false;
  if (
    !isAmount(position.apr) ||
    position.apr > 100 ||
    position.days !== product.days ||
    !isAmount(position.openedAt) ||
    !isAmount(position.unlockAt) ||
    position.unlockAt !== position.openedAt + position.days * DAY_MS
  )
    return false;
  if (position.status === 'active') return position.redeemedAt === undefined;
  return (
    position.status === 'redeemed' &&
    isAmount(position.redeemedAt) &&
    position.redeemedAt >= position.unlockAt
  );
}
export function earnPrincipal(state: WalletState, coin: Coin): number {
  return (state.earnPositions ?? [])
    .filter((position) => position.status === 'active' && position.coin === coin)
    .reduce((total, position) => total + position.principal, 0);
}
export function earnTotal(state: WalletState): number {
  return coins.reduce(
    (total, coin) => total + earnPrincipal(state, coin) * coinInfo[coin].price,
    0,
  );
}
export function earnPreview(position: EarnPosition, now = Date.now()): number {
  const end = Math.min(
    now,
    position.redeemedAt ?? Infinity,
    position.days ? position.unlockAt : Infinity,
  );
  const elapsed = Math.max(0, end - position.openedAt);
  return position.principal * (position.apr / 100) * (elapsed / (365 * DAY_MS));
}
export function validateEarnSubscription(
  state: WalletState,
  product: EarnProduct,
  rawAmount: string,
): string | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rawAmount.trim())) return '请输入有效的申购数量';
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) return '请输入大于 0 的有效数量';
  if (
    roundCoin(amount, product.coin) !== amount ||
    (rawAmount.trim().split('.')[1]?.length ?? 0) > coinInfo[product.coin].decimals ||
    !Number.isSafeInteger(Math.round(amount * 10 ** coinInfo[product.coin].decimals))
  )
    return `${product.coin} 最多支持 ${coinInfo[product.coin].decimals} 位小数`;
  if (amount < product.minimum)
    return `最低申购 ${quantity(product.minimum, product.coin)} ${product.coin}`;
  if (amount > state.balances[product.coin]) return `${product.coin} 可用余额不足`;
  return null;
}
export function subscribeEarn(
  state: WalletState,
  productId: string,
  rawAmount: string,
  requestId: string,
  now = Date.now(),
): WalletState {
  const product = findEarnProduct(productId);
  if (!product) throw new Error('理财产品不存在');
  if (
    !requestId.trim() ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    Number.isNaN(new Date(now).getTime()) ||
    Number.isNaN(new Date(now + product.days * DAY_MS).getTime())
  )
    throw new Error('申购请求无效');
  const existing = state.transactions.find((transaction) => transaction.id === requestId);
  if (existing) {
    if (
      existing.kind === 'earn-subscribe' &&
      existing.productId === productId &&
      existing.amount === Number(rawAmount)
    )
      return state;
    throw new Error('请求编号已被使用，请重新打开产品页面');
  }
  const error = validateEarnSubscription(state, product, rawAmount);
  if (error) throw new Error(error);
  const principal = Number(rawAmount);
  const position: EarnPosition = {
    id: `position-${requestId}`,
    productId,
    coin: product.coin,
    principal,
    apr: product.apr,
    days: product.days,
    openedAt: now,
    unlockAt: now + product.days * DAY_MS,
    status: 'active',
  };
  return {
    ...state,
    balances: {
      ...state.balances,
      [product.coin]: roundCoin(state.balances[product.coin] - principal, product.coin),
    },
    earnPositions: [position, ...(state.earnPositions ?? [])],
    transactions: [
      {
        id: requestId,
        kind: 'earn-subscribe',
        coin: product.coin,
        amount: principal,
        productId,
        positionId: position.id,
        createdAt: new Date(now).toISOString(),
        note: `${product.name} · 固定演示年化 ${product.apr}%`,
      },
      ...state.transactions,
    ],
  };
}
export function redeemEarn(
  state: WalletState,
  positionId: string,
  requestId: string,
  now = Date.now(),
): WalletState {
  const position = state.earnPositions?.find((item) => item.id === positionId);
  if (!position) throw new Error('理财持仓不存在');
  if (
    !requestId.trim() ||
    !Number.isSafeInteger(now) ||
    now < position.openedAt ||
    Number.isNaN(new Date(now).getTime())
  )
    throw new Error('赎回请求无效');
  const existing = state.transactions.find((transaction) => transaction.id === requestId);
  if (existing) {
    if (existing.kind === 'earn-redeem' && existing.positionId === positionId) return state;
    throw new Error('请求编号已被使用，请刷新后重试');
  }
  if (position.status === 'redeemed') return state;
  if (now < position.unlockAt) throw new Error('定期产品尚未到期，暂不能赎回');
  return {
    ...state,
    balances: {
      ...state.balances,
      [position.coin]: roundCoin(state.balances[position.coin] + position.principal, position.coin),
    },
    earnPositions: state.earnPositions?.map((item) =>
      item.id === positionId ? { ...item, status: 'redeemed', redeemedAt: now } : item,
    ),
    transactions: [
      {
        id: requestId,
        kind: 'earn-redeem',
        coin: position.coin,
        amount: position.principal,
        productId: position.productId,
        positionId,
        createdAt: new Date(now).toISOString(),
        note: '模拟赎回本金；展示收益不计入可用余额',
      },
      ...state.transactions,
    ],
  };
}
