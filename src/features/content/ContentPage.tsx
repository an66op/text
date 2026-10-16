import { useState } from 'react';
import { BookOpen, Camera, Hash, Plus, Search, X } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import PostFeed from './PostFeed';
import CatalogFeed from './components/CatalogFeed';
import ShortVideoFeed from './components/ShortVideoFeed';
import { catalog } from './fixtures';
import { contentRoutes } from './domain';
import type { CatalogModule, FeedTab } from './types';
import './content.css';

export default function ContentPage({ moduleName }: { moduleName: string }) {
  return <ModuleContent key={moduleName} moduleName={moduleName} />;
}
function ModuleContent({ moduleName }: { moduleName: string }) {
  const [params, setParams] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(Boolean(params.get('q') || params.get('topic')));
  const query = params.get('q') ?? params.get('topic') ?? '';
  const tab = params.get('tab') ?? '推荐';
  const tabs =
    moduleName === '世界'
      ? ['推荐', '最新', '热门']
      : moduleName === '小说'
        ? ['推荐', '热门']
        : ['推荐', '热门', '我的'];
  function setQuery(value: string) {
    const next = new URLSearchParams(params);
    next.delete('topic');
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  }
  if (moduleName === '小说' && tab === '我的') return <Navigate to={paths.bookshelf} replace />;
  return (
    <>
      <PageHeader
        title={moduleName}
        backTo={moduleName === '组织' ? paths.me : paths.discover}
        action={
          <div className="content-header-actions">
            {moduleName === '世界' && (
              <Link aria-label="发布世界动态" to={`${contentRoutes.compose}?target=world`}>
                <Camera size={21} />
              </Link>
            )}
            {moduleName === '组织' && (
              <Link aria-label="创建组织" to={contentRoutes.createCommunity}>
                <Plus size={22} />
              </Link>
            )}
            <button
              aria-label={searchOpen ? '关闭内容搜索' : '搜索当前版块'}
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (searchOpen) setQuery('');
              }}
            >
              {searchOpen ? <X size={21} /> : <Search size={21} />}
            </button>
          </div>
        }
      />
      {searchOpen && (
        <div className="content-search">
          <Search size={17} />
          <input
            autoFocus
            aria-label="搜索当前版块内容"
            placeholder={`搜索${moduleName}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      <div className={`content-body module-${moduleName}`}>
        {moduleName === '短视频' ? (
          <ShortVideoFeed query={query} />
        ) : (
          <>
            <div className="feed-tabs">
              {tabs.map((label) => (
                <button
                  key={label}
                  className={tab === label ? 'active' : ''}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set('tab', label);
                    setParams(next, { replace: true });
                  }}
                >
                  {label}
                </button>
              ))}
              {moduleName === '世界' && (
                <Link className="world-topic-link" to={contentRoutes.topics}>
                  <Hash size={16} />
                  话题
                </Link>
              )}
              {moduleName === '小说' && (
                <Link
                  className="novel-shelf-tab"
                  aria-label="打开书架"
                  to={contentRoutes.bookshelf}
                >
                  <BookOpen size={17} />
                  书架
                </Link>
              )}
            </div>
            {moduleName === '世界' ? (
              <PostFeed variant="world" query={query} tab={tab as FeedTab} />
            ) : moduleName in catalog ? (
              <CatalogFeed moduleName={moduleName as CatalogModule} query={query} tab={tab} />
            ) : (
              <div className="empty">暂时没有这个版块的内容。</div>
            )}
          </>
        )}
      </div>
    </>
  );
}
