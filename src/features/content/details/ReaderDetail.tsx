import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Bookmark, List, Settings2 } from 'lucide-react';
import { useContent } from '../useContent';
import { chapterTitles, contentRoutes, getChapterParagraphs } from '../domain';
import type { CatalogItem } from '../types';

export default function ReaderDetail({ item }: { item: CatalogItem }) {
  const {
    chapter: legacyChapter,
    reading,
    readerSettings,
    bookshelf,
    toggleShelf,
    saveReading,
  } = useContent();
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get('chapter'));
  const chapter = Math.min(
    chapterTitles.length,
    Math.max(
      1,
      Number.isInteger(requested) && requested > 0
        ? requested
        : (reading[item.id]?.chapter ?? (item.id === 'book-sea-letters' ? legacyChapter : 1)),
    ),
  );
  useEffect(() => {
    saveReading(item.id, chapter);
  }, [item.id, chapter, saveReading]);
  function select(value: number) {
    saveReading(item.id, value);
    setParams({ chapter: String(value) }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return (
    <article
      className={`reader-document theme-${readerSettings.theme}`}
      style={{ fontSize: readerSettings.size, lineHeight: readerSettings.lineHeight }}
    >
      <div className="reader-tools">
        <Link to={contentRoutes.chapters(item.id)}>
          <List size={18} />
          目录
        </Link>
        <button aria-label="保存阅读进度" onClick={() => saveReading(item.id, chapter)}>
          <Bookmark size={18} />
          保存进度
        </button>
        <Link aria-label="阅读设置" to={contentRoutes.readerSettings(item.id)}>
          <Settings2 size={18} />
        </Link>
      </div>
      <small>
        {item.title} · {chapter} / {chapterTitles.length}
      </small>
      <h2>
        第 {chapter} 章 · {chapterTitles[chapter - 1]}
      </h2>
      {getChapterParagraphs(item, chapter).map((paragraph) => (
        <p key={paragraph.slice(0, 25)}>{paragraph}</p>
      ))}
      <div className="reader-navigation">
        <button className="secondary" disabled={chapter === 1} onClick={() => select(chapter - 1)}>
          上一章
        </button>
        <button
          className="primary"
          disabled={chapter === chapterTitles.length}
          onClick={() => select(chapter + 1)}
        >
          下一章
        </button>
      </div>
      {chapter === chapterTitles.length && (
        <div className="reader-end">
          <h3>这段旅程，暂时告一段落</h3>
          <Link to={contentRoutes.book(item.id)}>回到书籍详情</Link>
        </div>
      )}
      <button className="reader-shelf-toggle" onClick={() => toggleShelf(item.id)}>
        {bookshelf.includes(item.id) ? '已在书架 · 移出' : '加入书架，下次继续读'}
      </button>
    </article>
  );
}
