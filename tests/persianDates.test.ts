import { describe, expect, it } from 'vitest';
import { jalaliToGregorian, normalizePersianDigits, parsePersianQuickAdd, parsePersianQuickDate } from '../src/lib/persianDates';

describe('Persian date helpers', () => {
  it('normalizes Persian and Arabic digits', () => {
    expect(normalizePersianDigits('۱۴۰۵/٠٢/۲۰ ساعت ۹')).toBe('1405/02/20 ساعت 9');
  });

  it('parses basic Persian quick-add dates and times', () => {
    const parsed = parsePersianQuickDate('نوشتن گزارش فردا ساعت ۹ #نوشتن !2', new Date(2026, 4, 13, 12));
    const due = new Date(parsed.dueAt!);

    expect(parsed.cleanedText).toContain('نوشتن گزارش');
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(4);
    expect(due.getDate()).toBe(14);
    expect(due.getHours()).toBe(9);
  });

  it('converts Jalali dates to Gregorian dates', () => {
    expect(jalaliToGregorian(1405, 2, 20)).toEqual({ gy: 2026, gm: 5, gd: 10 });
  });

  it('parses Todoist-style Persian quick add metadata', () => {
    const parsed = parsePersianQuickAdd('ارسال ایمیل فردا ساعت ۹ #کار /جلسه @ایمیل !1 هر هفته', new Date(2026, 4, 13, 12));

    expect(parsed.title).toBe('ارسال ایمیل');
    expect(parsed.projectName).toBe('کار');
    expect(parsed.sectionName).toBe('جلسه');
    expect(parsed.tagNames).toEqual(['ایمیل']);
    expect(parsed.priority).toBe(1);
    expect(parsed.recurrence).toEqual({ frequency: 'weekly', interval: 1 });
  });
});
