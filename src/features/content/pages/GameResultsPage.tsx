import { Link, useParams } from 'react-router';
import { Trophy } from 'lucide-react';
import PageHeader from '@/shared/ui/PageHeader';
import { paths } from '@/shared/config/paths';
import { useContent } from '../useContent';
import { catalog } from '../fixtures';
export default function GameResultsPage() {
  const { contentId } = useParams();
  const { results } = useContent();
  const item = catalog.游戏.find((game) => game.id === contentId);
  if (!item)
    return (
      <>
        <PageHeader title="成绩" backTo={paths.games} />
        <div className="empty">
          这款游戏不存在。<Link to={paths.games}>返回游戏</Link>
        </div>
      </>
    );
  const history = results.filter((result) => result.gameId === item.id);
  const latest = history[0];
  return (
    <>
      <PageHeader title="挑战成绩" backTo={paths.games} />
      <div className="content-page">
        <div className="game-score">
          <Trophy size={46} />
          <h2>{latest ? `${latest.score} 分` : '准备创造第一份成绩'}</h2>
          <p>
            {item.title}
            {latest ? ` · 本次完成 ${Math.round((latest.score / latest.total) * 100)}%` : ''}
          </p>
          {history.length > 0 && (
            <small>
              个人最佳 {Math.max(...history.map((result) => result.score))} 分 · 挑战{' '}
              {history.length} 次
            </small>
          )}
        </div>
        <Link className="primary full" to={paths.game(item.id)}>
          再来一局
        </Link>
        <h3>我的历史成绩</h3>
        {history.length ? (
          <div className="results-list">
            {history.map((result) => (
              <div key={result.id}>
                <span>
                  {new Date(result.completedAt).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <strong>
                  {result.score} / {result.total}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">完成挑战后，成绩会保存在这里。</div>
        )}
      </div>
    </>
  );
}
