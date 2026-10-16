import { describe, expect, it } from 'vitest';
import {
  aiStarters,
  defaultAiState,
  generateLocalReply,
  isAiState,
  newAiSession,
  userMessage,
} from './ai-model';

describe('local AI model and validation', () => {
  it('validates nested messages, unique sessions, draft limits and deleted records', () => {
    const session = newAiSession();
    expect(isAiState({ ...defaultAiState, sessions: [session] })).toBe(true);
    expect(isAiState({ ...defaultAiState, sessions: [session, session] })).toBe(false);
    expect(isAiState({ ...defaultAiState, sessions: [{ ...session, messages: [null] }] })).toBe(
      false,
    );
    expect(isAiState({ ...defaultAiState, homeDraft: 'x'.repeat(4001) })).toBe(false);
    expect(isAiState({ ...defaultAiState, deleted: { ...session, draft: 42 } })).toBe(false);
    expect(() => userMessage('  ')).toThrow('请输入');
  });
  it('returns starter content without repeated implementation notices', () => {
    aiStarters.forEach((starter) => {
      const result = generateLocalReply([userMessage(starter.prompt)]);
      expect(result).not.toMatch(/本地演示回复|预置|未调用真实模型/);
      expect(result.length).toBeGreaterThan(40);
    });
    expect(generateLocalReply([userMessage(aiStarters[1].prompt)])).toContain(
      '周六上午十点在美术馆门口集合',
    );
    expect(generateLocalReply([userMessage(aiStarters[2].prompt)])).toContain('Nice to meet you');
  });
  it('explains free-text limits and carries the turn count through a conversation', () => {
    const messages = [userMessage('请解释深海'), userMessage('再展开一点')];
    const result = generateLocalReply(messages);
    expect(result).toContain('第 2 个问题');
    expect(result).toContain('再展开一点');
    expect(result).toContain('当前为本地演示');
    expect(result).toContain('无法直接解答或联网核实');
  });
});
