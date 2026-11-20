import { isDateOnly } from './date-only.decorator';
import { parseStay } from '../dates';

describe('strict calendar dates (review fix)', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isDateOnly('2027-02-28')).toBe(true);
    expect(isDateOnly('2028-02-29')).toBe(true); // leap year
    expect(isDateOnly('2027-02-30')).toBe(false);
    expect(isDateOnly('2027-13-01')).toBe(false);
    expect(isDateOnly('2027-2-01')).toBe(false);
    expect(isDateOnly('not-a-date')).toBe(false);
  });

  it('never rolls an invalid stay into the next month', () => {
    expect(() => parseStay('2027-02-30', '2027-03-05')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'VALIDATION_FAILED',
          errors: [
            {
              field: 'checkInDate',
              messages: ['checkInDate must be a real calendar date'],
            },
          ],
        }),
      }),
    );
  });
});
