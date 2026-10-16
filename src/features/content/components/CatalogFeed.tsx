import { Bookmark, Play, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { useToast } from '@/shared/ui/useToast';
import { useContent } from '../useContent';
import { catalog } from '../fixtures';
import { routeForContent } from '../content-model';
import type { CatalogModule } from '../types';

export default function CatalogFeed({
  moduleName,
  query,
  tab,
}: {
  moduleName: CatalogModule;
  query: string;
  tab: string;
}) {
  const {
    bookshelf,
    memberships,
    follows,
    communities,
    reading,
    results,
    videoProgress,
    toggleShelf,
  } = useContent();
  const notify = useToast();
  const items = moduleName === '组织' ? [...communities, ...catalog.组织] : catalog[moduleName];
  const filtered = items.filter(
    (item) =>
      `${item.title} ${item.desc} ${item.category ?? ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (tab !== '我的' ||
        (moduleName === '直播'
          ? follows.includes(item.author ?? item.desc.split(' · ')[0])
          : moduleName === '视频'
            ? Boolean(videoProgress[item.id])
            : moduleName === '游戏'
              ? results.some((result) => result.gameId === item.id)
              : moduleName === '小说'
                ? bookshelf.includes(item.id) || Boolean(reading[item.id])
                : item.owner || memberships.includes(item.id))),
  );
  if (tab === '热门') filtered.reverse();
  return (
    <>
      <div className={`catalog-grid catalog-${moduleName}`}>
        {filtered.map((item) => (
          <article className="catalog" key={item.id}>
            <Link
              className="catalog-image"
              aria-label={`打开${item.title}`}
              to={routeForContent(item)}
            >
              <img src={item.img} alt={item.title} loading="lazy" />
              <span>{item.badge}</span>
              {(moduleName === '视频' || moduleName === '直播') && (
                <Play className="catalog-play" fill="white" />
              )}
            </Link>
            <div>
              <h3>
                <Link to={routeForContent(item)}>{item.title}</Link>
              </h3>
              <p>{item.desc}</p>
              <div className="catalog-bottom">
                {moduleName === '小说' ? (
                  <>
                    <span>
                      {reading[item.id]
                        ? `读至第 ${reading[item.id].chapter} 章`
                        : '为你推荐的好故事'}
                    </span>
                    <button
                      aria-label={`${bookshelf.includes(item.id) ? '移出书架' : '加入书架'} ${item.title}`}
                      onClick={() => {
                        toggleShelf(item.id);
                        notify(bookshelf.includes(item.id) ? '已移出书架' : '已加入书架');
                      }}
                    >
                      <Bookmark size={14} />
                      {bookshelf.includes(item.id) ? '已在书架' : '书架'}
                    </button>
                  </>
                ) : moduleName === '游戏' ? (
                  <>
                    <span>
                      <Trophy size={14} />
                      {results.some((result) => result.gameId === item.id)
                        ? `最佳 ${Math.max(...results.filter((result) => result.gameId === item.id).map((result) => result.score))} 分`
                        : '今天挑战一下自己'}
                    </span>
                    <Link to={routeForContent(item)}>开始玩</Link>
                  </>
                ) : (
                  <span>
                    {item.owner
                      ? '我创建的组织'
                      : moduleName === '视频' && videoProgress[item.id]
                        ? `继续看 · 第 ${videoProgress[item.id].episode} 集`
                        : moduleName === '组织' && memberships.includes(item.id)
                          ? '已加入组织'
                          : (item.category ?? item.badge)}
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="empty">
          {tab === '我的'
            ? '这里会记录你加入、关注和体验过的内容。'
            : '没有找到相关内容，试试其他关键词。'}
        </div>
      )}
    </>
  );
}
