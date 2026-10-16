import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trophy } from 'lucide-react';
import { useContent } from '../useContent';
import { contentRoutes } from '../domain';
import type { CatalogItem } from '../types';

const questions = [
  {
    text: '3、6、12、24，下一个数字是什么？',
    options: [36, 48, 42, 60],
    answer: 48,
    hint: '每个数字都翻倍了。',
  },
  {
    text: '1、4、9、16，下一个数字是什么？',
    options: [20, 24, 25, 32],
    answer: 25,
    hint: '这是连续整数的平方。',
  },
  {
    text: '2、3、5、8，下一个数字是什么？',
    options: [10, 11, 12, 13],
    answer: 13,
    hint: '每个数字都是前两个数字的和。',
  },
  {
    text: '一小时有多少秒？',
    options: [600, 1200, 3600, 6000],
    answer: 3600,
    hint: '60 分钟乘以 60 秒。',
  },
  {
    text: '7、14、21、28，下一个数字是什么？',
    options: [30, 32, 35, 42],
    answer: 35,
    hint: '每次增加 7。',
  },
];
const spaceQuestions = [
  {
    text: '第一段航线：2、4、8、16，下一个信号？',
    options: [24, 30, 32, 36],
    answer: 32,
    hint: '信号强度每次翻倍。',
  },
  {
    text: '燃料仓有 30 格，航行用去 12 格，还剩多少？',
    options: [12, 18, 20, 22],
    answer: 18,
    hint: '30 减去 12。',
  },
  {
    text: '星门编号：5、10、20、40，下一个编号？',
    options: [60, 70, 80, 90],
    answer: 80,
    hint: '仍然是翻倍的规律。',
  },
  {
    text: '三颗卫星各发出 9 个信号，共多少个？',
    options: [18, 24, 27, 36],
    answer: 27,
    hint: '3 乘以 9。',
  },
  {
    text: '目的地坐标：1、3、6、10，下一个数字？',
    options: [12, 14, 15, 16],
    answer: 15,
    hint: '依次增加 2、3、4、5。',
  },
];
export default function GameDetail({ item }: { item: CatalogItem }) {
  const [started, setStarted] = useState(false);
  const { results } = useContent();
  const previous = results.filter((result) => result.gameId === item.id);
  if (!started)
    return (
      <div className="content-page game-intro">
        <img className="detail-image" src={item.img} alt={item.title} />
        <span className="content-pill">{item.badge}</span>
        <h2>{item.title}</h2>
        <p>
          {item.id === 'game-forest'
            ? '翻开森林里的卡片，找到 4 对相同的伙伴。记住每一张的位置，尽量用更少的步数完成挑战。'
            : item.id === 'game-space'
              ? '驾驶飞船穿过 5 个星门。解开信号规律，每个正确答案获得 20 分，完成后记录本次成绩。'
              : '五道生活和逻辑小题，让大脑轻松热身。每题只有一次作答机会，准备好就开始吧。'}
        </p>
        <div className="game-record">
          <Trophy />
          <span>
            {previous.length
              ? `最佳 ${Math.max(...previous.map((result) => result.score))} 分 · 已玩 ${previous.length} 局`
              : '还没有成绩，来完成第一局'}
          </span>
        </div>
        <button className="primary full" onClick={() => setStarted(true)}>
          开始挑战
        </button>
        <Link className="content-link-row" to={contentRoutes.results(item.id)}>
          查看历史成绩
        </Link>
      </div>
    );
  return item.id === 'game-forest' ? <MemoryGame item={item} /> : <QuizGame item={item} />;
}
function QuizGame({ item }: { item: CatalogItem }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const { saveGameResult } = useContent();
  const navigate = useNavigate();
  const list = item.id === 'game-space' ? spaceQuestions : questions;
  const question = list[index];
  function next() {
    if (index === list.length - 1) {
      saveGameResult(item.id, score, 100);
      navigate(contentRoutes.results(item.id), { replace: true });
    } else {
      setIndex(index + 1);
      setSelected(null);
    }
  }
  return (
    <div className={`content-page game-session ${item.id === 'game-space' ? 'space-session' : ''}`}>
      <div className="game-progress">
        <strong>
          第 {index + 1} / {list.length} 题
        </strong>
        <span>{score} 分</span>
      </div>
      <progress max={list.length} value={index} />
      <h2>{question.text}</h2>
      <div className="game-options">
        {question.options.map((number) => (
          <button
            key={number}
            disabled={selected !== null}
            className={
              selected === number ? (number === question.answer ? 'correct' : 'incorrect') : ''
            }
            onClick={() => {
              if (selected !== null) return;
              setSelected(number);
              if (number === question.answer) setScore(score + 20);
            }}
          >
            {number}
          </button>
        ))}
      </div>
      {selected !== null && (
        <div className="game-answer" role="status">
          <strong>
            {selected === question.answer ? '答对了！+20 分 🎉' : `正确答案：${question.answer}`}
          </strong>
          <p>{question.hint}</p>
          <button className="primary full" onClick={next}>
            {index === list.length - 1 ? '完成挑战 · 查看成绩' : '下一题'}
          </button>
        </div>
      )}
    </div>
  );
}
const symbols = ['🌲', '🦊', '🍄', '🦋', '🍄', '🌲', '🦋', '🦊'];
function MemoryGame({ item }: { item: CatalogItem }) {
  const [opened, setOpened] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [turns, setTurns] = useState(0);
  const { saveGameResult } = useContent();
  const navigate = useNavigate();
  const completed = matched.length === symbols.length;
  function pick(index: number) {
    if (opened.length === 2 || matched.includes(index) || opened.includes(index)) return;
    const next = [...opened, index];
    setOpened(next);
    if (next.length === 2) {
      setTurns(turns + 1);
      if (symbols[next[0]] === symbols[next[1]]) {
        setMatched([...matched, ...next]);
        setOpened([]);
      }
    }
  }
  return (
    <div className="content-page memory-session">
      <div className="game-progress">
        <strong>已找到 {matched.length / 2} / 4 对</strong>
        <span>{turns} 步</span>
      </div>
      <h2>{completed ? '森林伙伴都找到了！' : '记住每一张的位置'}</h2>
      <div className="memory-grid">
        {symbols.map((symbol, index) => (
          <button
            aria-label={`翻开卡片 ${index + 1}`}
            className={matched.includes(index) ? 'matched' : opened.includes(index) ? 'opened' : ''}
            disabled={completed || matched.includes(index)}
            key={index}
            onClick={() => pick(index)}
          >
            {matched.includes(index) || opened.includes(index) ? symbol : '?'}
          </button>
        ))}
      </div>
      {opened.length === 2 && (
        <button className="secondary full" onClick={() => setOpened([])}>
          继续翻牌
        </button>
      )}
      {completed && (
        <>
          <p>
            完成挑战用了 {turns} 步，获得 {Math.max(10, 100 - Math.max(0, turns - 4) * 10)} 分。
          </p>
          <button
            className="primary full"
            onClick={() => {
              saveGameResult(item.id, Math.max(10, 100 - Math.max(0, turns - 4) * 10), 100);
              navigate(contentRoutes.results(item.id), { replace: true });
            }}
          >
            保存成绩
          </button>
        </>
      )}
    </div>
  );
}
