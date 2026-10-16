import { useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileText,
  LockKeyhole,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import { circlePaths } from './routes';
import { useCircles } from './useCircles';
import type { Circle } from './types';

type DirectoryTab = 'joined' | 'discover';

export default function CirclesPage() {
  const { circles } = useCircles();
  const [tab, setTab] = useState<DirectoryTab>('discover');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const directoryId = useId();
  const joined = circles.filter((circle) => circle.joined);
  const source = tab === 'joined' ? joined : circles;
  const categories = [...new Set(source.map((circle) => circle.category).filter(Boolean))];
  const activeCategory = categories.includes(category) ? category : '';
  const search = query.trim().toLowerCase();
  const visible = source.filter(
    (circle) =>
      (!activeCategory || circle.category === activeCategory) &&
      `${circle.name} ${circle.description} ${circle.category}`.toLowerCase().includes(search),
  );
  const featured =
    tab === 'discover' && !search && !activeCategory
      ? visible.find((circle) => !circle.joined) || visible[0]
      : undefined;
  const filtered = Boolean(search || activeCategory);
  const chooseTab = (next: DirectoryTab) => {
    setTab(next);
    setCategory('');
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
    chooseTab(nextIndex === 0 ? 'joined' : 'discover');
    tabRefs.current[nextIndex]?.focus();
  };
  const reset = () => {
    setQuery('');
    setCategory('');
  };

  return (
    <div className="circles-directory creator-directory">
      <header className="creator-directory-header">
        <Link className="creator-back-button" to={paths.discover} aria-label="返回发现">
          <ChevronLeft size={23} />
        </Link>
        <h1>圈子</h1>
        <Link className="creator-create-button" to={circlePaths.create}>
          <Plus size={17} />
          <span>创建</span>
        </Link>
      </header>
      <div className="creator-directory-toolbar">
        <div className="creator-directory-tabs" role="tablist" aria-label="圈子导航">
          {(
            [
              { key: 'joined', label: '我的' },
              { key: 'discover', label: '发现' },
            ] as const
          ).map((item, index) => (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`${directoryId}-${item.key}`}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              aria-controls={`${directoryId}-panel`}
              tabIndex={tab === item.key ? 0 : -1}
              onClick={() => chooseTab(item.key)}
              onKeyDown={(event) => onTabKey(event, index)}
            >
              {item.label}
              {item.key === 'joined' && joined.length > 0 && <span>{joined.length}</span>}
            </button>
          ))}
        </div>
        <div className="creator-directory-search">
          <Search size={18} />
          <input
            aria-label="搜索圈子"
            placeholder="搜索圈子、兴趣"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      <div id={`${directoryId}-panel`} role="tabpanel" aria-labelledby={`${directoryId}-${tab}`}>
        {tab === 'joined' && joined.length > 0 && !filtered && (
          <nav className="creator-joined-rail" aria-label="已加入的圈子">
            {joined.map((circle) => (
              <Link to={circlePaths.home(circle.id)} key={circle.id}>
                <span style={{ backgroundImage: `url(${circle.cover})` }}>
                  <i>{circle.icon}</i>
                </span>
                <strong>{circle.name}</strong>
              </Link>
            ))}
            <Link className="creator-rail-add" to={circlePaths.create}>
              <span>
                <Plus size={24} />
              </span>
              <strong>创建圈子</strong>
            </Link>
          </nav>
        )}
        <div className="creator-category-chips" aria-label="圈子分类">
          <button type="button" aria-pressed={!activeCategory} onClick={() => setCategory('')}>
            全部
          </button>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={activeCategory === item}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {featured && (
          <Link
            className="creator-featured-circle"
            to={circlePaths.home(featured.id)}
            style={{ backgroundImage: `url(${featured.cover})` }}
            aria-label={`推荐圈子：${featured.name}`}
          >
            <span className="creator-featured-label">
              推荐<span>·</span>
              {featured.category}
            </span>
            <div className="creator-featured-main">
              <span className="creator-featured-icon">{featured.icon}</span>
              <div>
                <h2>{featured.name}</h2>
                <p>{featured.description}</p>
              </div>
            </div>
            <div className="creator-featured-footer">
              <span>
                <Users size={14} />
                {featured.memberCount.toLocaleString()} 位成员
              </span>
              <span className="creator-featured-access">
                {featured.visibility === 'invite' ? (
                  <>
                    <LockKeyhole size={12} />
                    邀请制
                  </>
                ) : (
                  '免费加入'
                )}
              </span>
              <i>
                <ArrowUpRight size={20} />
              </i>
            </div>
          </Link>
        )}
        <section
          className="creator-directory-section"
          aria-label={tab === 'joined' ? '我的圈子' : '发现圈子'}
        >
          <div className="creator-section-heading">
            <h2>{filtered ? '筛选结果' : tab === 'joined' ? '我的圈子' : '全部圈子'}</h2>
            <span>{visible.length} 个圈子</span>
            {filtered && (
              <button type="button" onClick={reset}>
                重置
              </button>
            )}
          </div>
          <div className="creator-circle-grid">
            {visible.map((circle) => (
              <CircleDirectoryCard key={circle.id} circle={circle} />
            ))}
          </div>
          {!visible.length && (
            <div className="creator-directory-empty">
              <Compass size={32} />
              <h2>{filtered ? '没有找到相关圈子' : '还没有加入圈子'}</h2>
              <p>{filtered ? '试试其他关键词或分类。' : '发现感兴趣的圈子，或创建自己的圈子。'}</p>
              {filtered ? (
                <button className="secondary" type="button" onClick={reset}>
                  清除筛选
                </button>
              ) : (
                <button className="secondary" type="button" onClick={() => chooseTab('discover')}>
                  去发现
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CircleDirectoryCard({ circle }: { circle: Circle }) {
  const { getMembers, getPosts } = useCircles();
  // Membership is checked before asking for member or content records.
  const owner = circle.joined
    ? getMembers(circle.id).find((member) => member.role === 'owner')
    : undefined;
  const posts = circle.joined ? getPosts(circle.id) : undefined;
  const latest = posts?.reduce<(typeof posts)[number] | undefined>(
    (current, post) => (!current || post.createdAt > current.createdAt ? post : current),
    undefined,
  );
  return (
    <Link className="creator-circle-card" to={circlePaths.home(circle.id)}>
      <div className="creator-card-cover" style={{ backgroundImage: `url(${circle.cover})` }}>
        <span className="creator-card-category">{circle.category}</span>
        {circle.joined && <span className="creator-card-joined">已加入</span>}
        <span className="creator-card-icon">{circle.icon}</span>
      </div>
      <div className="creator-card-body">
        <div className="creator-card-title">
          <h3>{circle.name}</h3>
          {circle.visibility === 'invite' && <LockKeyhole size={14} />}
        </div>
        <div className="creator-card-author">
          {owner ? (
            <>
              <img src={owner.avatar} alt="" />
              <span>{owner.name}</span>
              <small>圈主</small>
            </>
          ) : (
            <span>{circle.category}</span>
          )}
          {circle.role === 'owner' && <small className="creator-card-role">我创建的</small>}
        </div>
        <p>{circle.description}</p>
        {latest && (
          <div className="creator-card-latest">
            <FileText size={13} />
            <span>{latest.title}</span>
            <ChevronRight size={13} />
          </div>
        )}
        <div className="creator-card-stats">
          <span>
            <Users size={13} />
            {circle.memberCount.toLocaleString()} 位成员
          </span>
          {posts && (
            <span>
              <FileText size={12} />
              {posts.length} 篇内容
            </span>
          )}
        </div>
        <div className="creator-card-footer">
          <span className={circle.visibility === 'invite' ? 'invite' : ''}>
            {circle.visibility === 'invite' ? (
              <>
                <LockKeyhole size={12} />
                邀请制
              </>
            ) : (
              '免费'
            )}
          </span>
          <strong>
            {circle.joined ? '进入圈子' : '了解圈子'}
            <ChevronRight size={15} />
          </strong>
        </div>
      </div>
    </Link>
  );
}
