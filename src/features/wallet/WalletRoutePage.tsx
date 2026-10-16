import WalletExchangePage from './WalletExchangePage';
import { TransferPage, TransferReviewPage } from './WalletTransferPages';
import { WalletAssetPage, WalletHistoryPage, WalletTransactionPage } from './WalletDetailsPages';
import WalletReceivePage from './WalletReceivePage';
import './wallet.css';

export default function WalletRoutePage({
  kind,
}: {
  kind:
    'transfer' | 'review' | 'result' | 'receive' | 'exchange' | 'history' | 'transaction' | 'asset';
}) {
  switch (kind) {
    case 'transfer':
      return <TransferPage />;
    case 'review':
      return <TransferReviewPage />;
    case 'receive':
      return <WalletReceivePage />;
    case 'exchange':
      return <WalletExchangePage />;
    case 'history':
      return <WalletHistoryPage />;
    case 'asset':
      return <WalletAssetPage />;
    case 'transaction':
      return <WalletTransactionPage />;
    case 'result':
      return <WalletTransactionPage result />;
  }
}
