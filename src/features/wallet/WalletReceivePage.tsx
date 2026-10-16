import { useEffect, useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { useNavigate, useSearchParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { useToast } from '@/shared/ui/useToast';
import { addDemoReceipt, coinInfo, coins, demoAddress, isCoin, type Coin } from './wallet-model';
import { useWallet } from './useWallet';

export default function WalletReceivePage() {
  const [searchParams] = useSearchParams();
  const requestedCoin = searchParams.get('coin');
  const [coin, setCoin] = useState<Coin>(isCoin(requestedCoin) ? requestedCoin : 'USDC');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const { commit } = useWallet();
  const navigate = useNavigate();
  const notify = useToast();
  const submitting = useRef(false);
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(`${demoAddress}?asset=${coin}`, {
      width: 240,
      margin: 2,
      color: { dark: '#27213f', light: '#ffffff' },
    })
      .then((url) => {
        if (alive) setCode(url);
      })
      .catch(() => {
        if (alive) setError('二维码生成失败，可直接复制下方演示地址');
      });
    return () => {
      alive = false;
    };
  }, [coin]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(demoAddress);
      notify('演示收款地址已复制');
    } catch {
      setError('复制失败，请长按下方地址进行复制');
    }
  };
  const receive = () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const id = crypto.randomUUID();
      commit((current) => addDemoReceipt(current, coin, id));
      navigate(`/wallet/result/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '测试收款失败');
      submitting.current = false;
    }
  };
  return (
    <div className="wallet-page">
      <PageHeader title="收款" backTo="/wallet" />
      <div className="wallet-content">
        <label className="wallet-field-label">
          收款资产
          <select
            className="field"
            aria-label="收款资产"
            value={coin}
            onChange={(event) => setCoin(event.target.value as Coin)}
          >
            {coins.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <section className="wallet-receive-card">
          <span className="wallet-demo-pill">仅用于模拟收款</span>
          <h1>{coin} 收款码</h1>
          <p>{coinInfo[coin].network}</p>
          <div className="wallet-qr-box">
            {code ? (
              <img src={code} alt={`${coin} 演示收款二维码`} width="240" height="240" />
            ) : (
              <span>正在生成二维码…</span>
            )}
          </div>
          <code className="wallet-address-value">{demoAddress}</code>
          <button className="primary full" onClick={() => void copy()}>
            <Copy size={17} />
            复制演示地址
          </button>
          {code && (
            <a className="wallet-secondary-link" download={`gongming-demo-${coin}.png`} href={code}>
              <Download size={17} />
              保存收款码
            </a>
          )}
        </section>
        <div className="wallet-note">二维码编码演示地址与币种，请勿向该地址发送真实资产。</div>
        <section className="wallet-test-receipt">
          <h2>体验收款到账</h2>
          <p>
            添加一笔 {coin === 'USDC' ? '25 USDC' : coin === 'ETH' ? '0.01 ETH' : '0.0005 BTC'}{' '}
            测试收款，查看余额和记录同步变化。
          </p>
          <button className="wallet-outline full" onClick={receive}>
            添加一笔测试收款
          </button>
        </section>
        {error && (
          <p className="wallet-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
