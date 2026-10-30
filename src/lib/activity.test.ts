import { describe, expect, it } from 'vitest';
import { BLOCKS_PER_DAY, classifyActivity } from './activity';

describe('classifyActivity', () => {
  it('treats a para included within the last week as active', () => {
    expect(classifyActivity(0)).toBe('active');
    expect(classifyActivity(6 * BLOCKS_PER_DAY)).toBe('active');
  });

  it('treats a para silent for a week up to a year as stalled', () => {
    expect(classifyActivity(8 * BLOCKS_PER_DAY)).toBe('stalled');
    expect(classifyActivity(364 * BLOCKS_PER_DAY)).toBe('stalled');
  });

  it('drops paras silent for over a year', () => {
    expect(classifyActivity(400 * BLOCKS_PER_DAY)).toBe('retired');
  });
});
