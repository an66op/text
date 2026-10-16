import { Link, useNavigate, useParams } from 'react-router';
import { Bookmark, BookOpen, ChevronRight, List, Star } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { useToast } from '@/shared/ui/useToast';
import { useContent } from '../useContent';
import { catalog } from '../fixtures';
import { chapterTitles, contentRoutes } from '../domain';

export function BookPage() {
  const { contentId } = useParams();
  const { bookshelf, toggleShelf, reading } = useContent();
  const notify = useToast();
  const item = catalog.小说.find((book) => book.id === contentId);
  if (!item) return <MissingBook />;
  const saved = bookshelf.includes(item.id);
  const chapter = reading[item.id]?.chapter ?? 1;
  return (
    <>
      <PageHeader title="书籍详情" backTo={paths.library} />
      <div className="content-page book-detail">
        <div className="book-overview">
          <img src={item.img} alt={`${item.title}封面`} />
          <div>
            <h2>{item.title}</h2>
            <p>{item.desc.split(' · ')[0]}</p>
            <span className="content-pill">{item.badge}</span>
            <p>12 章体验正文 · 每本独立保存阅读进度</p>
          </div>
        </div>
        <div className="book-rating">
          <strong>
            <Star size={18} fill="currentColor" />
            9.4
          </strong>
          <span>128 条读者推荐</span>
          <span>适合安静的午后</span>
        </div>
        <h3>故事简介</h3>
        <p className="book-introduction">
          {item.title === '时间的旅人'
            ? '一封来自未来的信，让她重新走过那些曾经错过的日子。当时间可以被回望，人该如何选择真正重要的东西？'
            : `离开熟悉的城市，她带着一本旧笔记和一封未寄出的信，走向山海之间。《${item.title}》记录那些微小却闪亮的相遇，关于成长、陪伴，和重新发现生活的勇气。`}
        </p>
        <Link className="content-link-row" to={contentRoutes.chapters(item.id)}>
          <List size={19} />
          <strong>目录</strong>
          <span>全部 12 章</span>
          <ChevronRight size={18} />
        </Link>
        <h3>读者声音</h3>
        {['像收到一封来自朋友的信，读完会想出去走走。', '文字很安静，让人愿意放慢速度。'].map(
          (review, index) => (
            <div className="book-review" key={review}>
              <strong>{index === 0 ? '北岛' : 'Mia'} · ★★★★★</strong>
              <p>{review}</p>
            </div>
          ),
        )}
        <div className="page-action-bar">
          <button
            className={saved ? 'secondary' : 'primary'}
            onClick={() => {
              toggleShelf(item.id);
              notify(saved ? '已移出书架' : '已加入书架');
            }}
          >
            <Bookmark size={18} />
            {saved ? '已在书架' : '加入书架'}
          </button>
          <Link className="primary" to={`${paths.read(item.id)}?chapter=${chapter}`}>
            <BookOpen size={18} />
            {reading[item.id] ? '继续阅读' : '开始阅读'}
          </Link>
        </div>
      </div>
    </>
  );
}
export function ChaptersPage() {
  const { contentId } = useParams();
  const { reading, saveReading } = useContent();
  const item = catalog.小说.find((book) => book.id === contentId);
  const navigate = useNavigate();
  if (!item) return <MissingBook />;
  return (
    <>
      <PageHeader title="章节目录" backTo={contentRoutes.book(item.id)} />
      <div className="content-page">
        <h2>{item.title}</h2>
        <p className="content-note">全部 12 章 · 点击即可阅读</p>
        <div className="chapter-list">
          {chapterTitles.map((title, index) => (
            <button
              className={reading[item.id]?.chapter === index + 1 ? 'reading-now' : ''}
              key={title}
              onClick={() => {
                saveReading(item.id, index + 1);
                navigate(`${paths.read(item.id)}?chapter=${index + 1}`);
              }}
            >
              <span>
                第 {index + 1} 章 · {title}
              </span>
              {reading[item.id]?.chapter === index + 1 ? (
                <small>正在读</small>
              ) : (
                <ChevronRight size={17} />
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
export function BookshelfPage() {
  const { bookshelf, reading, toggleShelf } = useContent();
  const notify = useToast();
  const books = catalog.小说.filter((item) => bookshelf.includes(item.id));
  return (
    <>
      <PageHeader
        title="书架"
        backTo={paths.library}
        action={
          <Link className="text-primary" to={paths.library}>
            找书
          </Link>
        }
      />
      <div className="content-page">
        <p className="content-note">{books.length} 本好书 · 阅读进度自动保存在本机</p>
        <div className="bookshelf-grid">
          {books.map((item) => (
            <article key={item.id}>
              <Link to={contentRoutes.book(item.id)}>
                <img src={item.img} alt={item.title} />
                <strong>{item.title}</strong>
                <small>
                  {reading[item.id]
                    ? `第 ${reading[item.id].chapter} 章 · ${Math.round((reading[item.id].chapter / chapterTitles.length) * 100)}%`
                    : '尚未开始'}
                </small>
              </Link>
              <div>
                <Link to={paths.read(item.id)}>继续阅读</Link>
                <button
                  onClick={() => {
                    toggleShelf(item.id);
                    notify('已移出书架');
                  }}
                >
                  移除
                </button>
              </div>
            </article>
          ))}
        </div>
        {books.length === 0 && (
          <div className="content-empty">
            <BookOpen size={45} />
            <h3>给书架留一本喜欢的书</h3>
            <p>在书籍详情里加入书架，下次从这里继续读。</p>
            <Link className="primary" to={paths.library}>
              发现好书
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
export function ReadingSettingsPage() {
  const { contentId } = useParams();
  const { readerSettings, setReaderSettings } = useContent();
  const item = catalog.小说.find((book) => book.id === contentId);
  if (!item) return <MissingBook />;
  return (
    <>
      <PageHeader title="阅读设置" backTo={paths.read(item.id)} />
      <div className="content-page">
        <label className="reader-option">
          <strong>字号</strong>
          <span>{readerSettings.size} px</span>
          <input
            aria-label="阅读字号"
            type="range"
            min={14}
            max={26}
            value={readerSettings.size}
            onChange={(event) =>
              setReaderSettings({ ...readerSettings, size: Number(event.target.value) })
            }
          />
        </label>
        <label className="reader-option">
          <strong>行距</strong>
          <span>{readerSettings.lineHeight.toFixed(1)}</span>
          <input
            aria-label="阅读行距"
            type="range"
            min={1.5}
            max={2.5}
            step={0.1}
            value={readerSettings.lineHeight}
            onChange={(event) =>
              setReaderSettings({ ...readerSettings, lineHeight: Number(event.target.value) })
            }
          />
        </label>
        <h3>阅读主题</h3>
        <div className="reader-themes">
          {(
            [
              ['paper', '纸张'],
              ['white', '明亮'],
              ['night', '夜间'],
            ] as const
          ).map(([theme, label]) => (
            <button
              key={theme}
              className={`theme-${theme} ${readerSettings.theme === theme ? 'selected' : ''}`}
              aria-pressed={readerSettings.theme === theme}
              onClick={() => setReaderSettings({ ...readerSettings, theme })}
            >
              {label}
            </button>
          ))}
        </div>
        <p
          className={`reading-preview theme-${readerSettings.theme}`}
          style={{ fontSize: readerSettings.size, lineHeight: readerSettings.lineHeight }}
        >
          晚风从海面吹来，街上的灯一盏接一盏亮起。阅读，是留给自己的一个安静角落。
        </p>
        <p className="content-note">设置立即生效，自动保存在本机。</p>
      </div>
    </>
  );
}
function MissingBook() {
  return (
    <>
      <PageHeader title="书籍不存在" backTo={paths.library} />
      <div className="empty">
        这本书暂时无法查看。<Link to={paths.library}>返回书城</Link>
      </div>
    </>
  );
}
