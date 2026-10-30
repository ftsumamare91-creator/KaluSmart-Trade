import { isValidFeePercent } from './config';

describe('isValidFeePercent', () => {
  it('accepts 0 to 100 with up to two decimals', () => {
    expect(isValidFeePercent('0')).toBe(true);
    expect(isValidFeePercent('2.5')).toBe(true);
    expect(isValidFeePercent('100')).toBe(true);
  });
  it('rejects symbols, too many decimals and values above 100', () => {
    expect(isValidFeePercent('2.5%')).toBe(false);
    expect(isValidFeePercent('2.555')).toBe(false);
    expect(isValidFeePercent('101')).toBe(false);
    expect(isValidFeePercent('abc')).toBe(false);
  });
});
