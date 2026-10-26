import { describe, expect, it } from 'vitest';
import { formatGem, parseGem, validAddress, validChain } from './wallet-model';

describe('server test ledger quantities', () => {
  it('converts decimal input to exact integer units without floating point rounding', () => {
    expect(parseGem('0.29')).toBe('29');
    expect(parseGem('1000.1')).toBe('100010');
    expect(formatGem('-100001')).toBe('-1,000.01');
  });
  it('rejects zero, exponent, negative, excess decimals and oversized amounts', () => {
    for (const input of ['0', '0.00', '-1', '1e2', '.2', '01.2', '0.001', '1000000000', 'NaN', ''])
      expect(parseGem(input), input).toBeNull();
  });
  it('accepts only public Ethereum address and hex network formats', () => {
    expect(validAddress(`0x${'a'.repeat(40)}`)).toBe(true);
    expect(validAddress('javascript:alert(1)')).toBe(false);
    expect(validChain('0x1')).toBe(true);
    expect(validChain('1')).toBe(false);
  });
});
