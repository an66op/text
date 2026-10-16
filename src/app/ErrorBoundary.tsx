import { Component, type ErrorInfo, type ReactNode } from 'react';
import { paths } from '@/shared/config/paths';

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面加载失败', error, info.componentStack);
  }
  render() {
    if (this.state.hasError)
      return (
        <div className="route-status">
          <h1>页面暂时无法打开</h1>
          <p>本地数据仍然保留，可以重新加载再试。</p>
          <button className="primary" onClick={() => window.location.assign(paths.social)}>
            重新打开
          </button>
        </div>
      );
    return this.props.children;
  }
}
