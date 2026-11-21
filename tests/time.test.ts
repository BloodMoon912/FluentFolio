import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HONG_KONG_TIME_ZONE,
  HONG_KONG_UTC_OFFSET,
  estimateReadingMinutes,
  formatHKTDate,
  formatHKTDateTime,
  formatHKTTime,
} from '../src/lib/time.ts';

describe('Hong Kong time constants', () => {
  it('exposes the IANA zone and the UTC offset the site renders', () => {
    assert.equal(HONG_KONG_TIME_ZONE, 'Asia/Hong_Kong');
    assert.equal(HONG_KONG_UTC_OFFSET, '+08:00');
  });
});

describe('HKT formatting', () => {
  it('shifts a UTC instant across the date boundary', () => {
    // 2026-01-02 23:30 UTC is 2026-01-03 07:30 in Hong Kong.
    assert.equal(formatHKTDate('2026-01-02T23:30:00Z'), formatHKTDate('2026-01-03T07:30:00Z'));
    assert.notEqual(formatHKTDate('2026-01-02T23:30:00Z'), formatHKTDate('2026-01-02T12:00:00Z'));
  });

  it('formats a date-time as 24-hour local time', () => {
    const rendered = formatHKTDateTime('2026-01-02T23:30:00Z');
    assert.match(rendered, /2026/);
    assert.match(rendered, /07/);
    assert.equal(/AM|PM/i.test(rendered), false);
  });

  it('accepts Date, ISO string and epoch milliseconds alike', () => {
    const instant = Date.UTC(2026, 0, 2, 23, 30, 0);
    const fromDate = formatHKTDate(new Date(instant));
    assert.equal(formatHKTDate(instant), fromDate);
    assert.equal(formatHKTDate('2026-01-02T23:30:00Z'), fromDate);
  });

  it('renders a time-of-day without a date', () => {
    const time = formatHKTTime('2026-01-02T23:30:00Z');
    assert.match(time, /07/);
    assert.equal(time.includes('2026'), false);
  });
});

describe('estimateReadingMinutes', () => {
  it('never returns less than one minute', () => {
    assert.equal(estimateReadingMinutes(''), 1);
    assert.equal(estimateReadingMinutes('hello world'), 1);
    assert.equal(estimateReadingMinutes('你好世界'), 1);
  });

  it('counts CJK characters and Latin words as comparable units', () => {
    const twentyFiveHundredWords = Array.from({ length: 3000 }, () => 'word').join(' ');
    assert.equal(estimateReadingMinutes(twentyFiveHundredWords), 10);
  });

  it('ignores fenced code blocks, inline code, links and images', () => {
    const noisy = [
      '```',
      ...Array.from({ length: 2000 }, () => 'word'),
      '```',
      '![alt](https://example.com/image.png)',
      '[link text](https://example.com/page)',
      '`inline code`',
    ].join('\n');
    assert.equal(estimateReadingMinutes(noisy), 1);
  });
});
