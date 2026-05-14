import type { RecurrenceRule, TaskPriority } from '../types';

const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

const weekdayMap = new Map<string, number>([
  ['شنبه', 6],
  ['یکشنبه', 0],
  ['يكشنبه', 0],
  ['دوشنبه', 1],
  ['سه شنبه', 2],
  ['سه‌شنبه', 2],
  ['چهارشنبه', 3],
  ['پنجشنبه', 4],
  ['جمعه', 5]
]);

export function normalizePersianDigits(value: string): string {
  return value
    .split('')
    .map((char) => {
      const persianIndex = persianDigits.indexOf(char);
      if (persianIndex >= 0) return String(persianIndex);
      const arabicIndex = arabicDigits.indexOf(char);
      if (arabicIndex >= 0) return String(arabicIndex);
      return char;
    })
    .join('');
}

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => persianDigits[Number(digit)]);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(isoDate: string | null, baseDate = new Date()): boolean {
  if (!isoDate) return false;
  return isSameLocalDay(new Date(isoDate), baseDate);
}

export function isPastDay(isoDate: string | null, baseDate = new Date()): boolean {
  if (!isoDate) return false;
  return startOfLocalDay(new Date(isoDate)) < startOfLocalDay(baseDate);
}

export function isWithinNextDays(isoDate: string | null, days: number, baseDate = new Date()): boolean {
  if (!isoDate) return false;
  const date = startOfLocalDay(new Date(isoDate));
  const today = startOfLocalDay(baseDate);
  const end = addDays(today, days);
  return date >= today && date <= end;
}

export function formatPersianDate(isoDate: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!isoDate) return 'بدون تاریخ';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...options
  }).format(new Date(isoDate));
}

export function formatPersianTime(isoDate: string | null): string {
  if (!isoDate) return '';
  return new Intl.DateTimeFormat('fa-IR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(isoDate));
}

export interface ParsedQuickDate {
  dueAt: string | null;
  cleanedText: string;
  matchedTokens: string[];
}

export interface ParsedQuickAdd extends ParsedQuickDate {
  title: string;
  priority: TaskPriority;
  projectName: string | null;
  sectionName: string | null;
  tagNames: string[];
  recurrence: RecurrenceRule | null;
}

export function parsePersianQuickDate(input: string, baseDate = new Date()): ParsedQuickDate {
  let text = normalizePersianDigits(input).replace(/\s+/g, ' ').trim();
  const matchedTokens: string[] = [];
  let dueDate: Date | null = null;
  let time: { hour: number; minute: number } | null = null;

  const timeMatch = text.match(/(?:ساعت)\s*(\d{1,2})(?::(\d{2}))?/);
  if (timeMatch) {
    time = {
      hour: clamp(Number(timeMatch[1]), 0, 23),
      minute: clamp(Number(timeMatch[2] ?? '0'), 0, 59)
    };
    matchedTokens.push(timeMatch[0]);
    text = text.replace(timeMatch[0], ' ');
  }

  const jalaliMatch = text.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (jalaliMatch) {
    const [, jy, jm, jd] = jalaliMatch;
    const gregorian = jalaliToGregorian(Number(jy), Number(jm), Number(jd));
    dueDate = new Date(gregorian.gy, gregorian.gm - 1, gregorian.gd);
    matchedTokens.push(jalaliMatch[0]);
    text = text.replace(jalaliMatch[0], ' ');
  }

  if (!dueDate) {
    const relative = [
      { token: 'پس فردا', offset: 2 },
      { token: 'پس‌فردا', offset: 2 },
      { token: 'فردا', offset: 1 },
      { token: 'امروز', offset: 0 },
      { token: 'هفته بعد', offset: 7 }
    ].find(({ token }) => text.includes(token));

    if (relative) {
      dueDate = startOfLocalDay(addDays(baseDate, relative.offset));
      matchedTokens.push(relative.token);
      text = text.replace(relative.token, ' ');
    }
  }

  if (!dueDate) {
    for (const [weekday, weekdayIndex] of weekdayMap) {
      if (text.includes(weekday)) {
        dueDate = nextWeekday(baseDate, weekdayIndex);
        matchedTokens.push(weekday);
        text = text.replace(weekday, ' ');
        break;
      }
    }
  }

  if (!dueDate && time) {
    dueDate = startOfLocalDay(baseDate);
  }

  if (dueDate && time) {
    dueDate.setHours(time.hour, time.minute, 0, 0);
  } else if (dueDate) {
    dueDate.setHours(9, 0, 0, 0);
  }

  return {
    dueAt: dueDate?.toISOString() ?? null,
    cleanedText: text.replace(/\s+/g, ' ').trim(),
    matchedTokens
  };
}

export function parsePersianQuickAdd(input: string, baseDate = new Date()): ParsedQuickAdd {
  const parsedDate = parsePersianQuickDate(input, baseDate);
  let text = parsedDate.cleanedText;
  const matchedTokens = [...parsedDate.matchedTokens];

  const recurrenceTokens: Array<{ token: string; rule: RecurrenceRule }> = [
    { token: 'هر روز', rule: { frequency: 'daily', interval: 1 } },
    { token: 'هرروز', rule: { frequency: 'daily', interval: 1 } },
    { token: 'هر هفته', rule: { frequency: 'weekly', interval: 1 } },
    { token: 'هرهفته', rule: { frequency: 'weekly', interval: 1 } },
    { token: 'هر ماه', rule: { frequency: 'monthly', interval: 1 } },
    { token: 'هرماه', rule: { frequency: 'monthly', interval: 1 } }
  ];

  let recurrence: RecurrenceRule | null = null;
  for (const { token, rule } of recurrenceTokens) {
    if (text.includes(token)) {
      recurrence = rule;
      matchedTokens.push(token);
      text = text.replace(token, ' ');
      break;
    }
  }

  const priorityMatch = text.match(/!(1|2|3|4)/);
  const priority = priorityMatch ? (Number(priorityMatch[1]) as TaskPriority) : 4;
  if (priorityMatch) {
    matchedTokens.push(priorityMatch[0]);
    text = text.replace(priorityMatch[0], ' ');
  }

  const projectNames = Array.from(text.matchAll(/#([\p{L}\p{N}_-]+)/gu)).map((match) => match[1]);
  const tagNames = Array.from(text.matchAll(/@([\p{L}\p{N}_-]+)/gu)).map((match) => match[1]);
  const sectionMatch = text.match(/\/([\p{L}\p{N}_-]+)/u);
  const projectName = projectNames[0] ?? null;
  const sectionName = sectionMatch?.[1] ?? null;

  for (const token of [...projectNames.map((name) => `#${name}`), ...tagNames.map((name) => `@${name}`)]) {
    matchedTokens.push(token);
    text = text.replace(token, ' ');
  }

  if (sectionMatch) {
    matchedTokens.push(sectionMatch[0]);
    text = text.replace(sectionMatch[0], ' ');
  }

  const title = text.replace(/\s+/g, ' ').trim();

  return {
    ...parsedDate,
    cleanedText: title,
    title,
    priority,
    projectName,
    sectionName,
    tagNames,
    recurrence,
    matchedTokens
  };
}

function nextWeekday(baseDate: Date, weekdayIndex: number): Date {
  const base = startOfLocalDay(baseDate);
  const delta = (weekdayIndex - base.getDay() + 7) % 7 || 7;
  const next = addDays(base, delta);
  next.setHours(9, 0, 0, 0);
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Public-domain style Jalaali conversion adapted into a tiny local helper.
export function jalaliToGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  jy += 1595;
  let days =
    -355668 +
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);

  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;

  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }

  gy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  const gd = days + 1;
  const salA = [0, 31, isGregorianLeap(gy) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  let remainingDays = gd;
  for (gm = 1; gm <= 12 && remainingDays > salA[gm]; gm++) {
    remainingDays -= salA[gm];
  }
  return { gy, gm, gd: remainingDays };
}

function isGregorianLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
