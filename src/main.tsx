import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@/styles/base.css';
import '@/styles/social.css';
import '@/styles/messenger-shell.css';
import '@/styles/engineering.css';
import '@/features/content/content.css';
import '@/features/content/moments.css';
import '@/features/profile/profile.css';
import '@/features/wallet/wallet.css';
import '@/styles/ios-theme.css';
import '@/features/profile/profile-design.css';
import '@/features/wallet/wallet-design.css';
import '@/features/discovery/discovery-design.css';
import '@/features/social/social-design.css';
import '@/features/content/content-design.css';
import '@/features/circles/circles.css';
import '@/features/circles/management.css';
import '@/features/circles/channel-content.css';
import '@/features/circles/creator-home.css';
import '@/features/circles/creator-directory.css';
import '@/features/circles/creator-post.css';
import '@/features/wallet/wallet-earn.css';
import '@/features/social/social-channels.css';
import '@/features/matching/matching.css';
import '@/features/shop/shop.css';
import '@/features/ai/ai.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
