import type { DayKey } from '../domain/types';

export const weekDayMeta: Array<{ key: DayKey; short: string; long: string }> = [
  { key: 'mon', short: '월', long: '월요일' },
  { key: 'tue', short: '화', long: '화요일' },
  { key: 'wed', short: '수', long: '수요일' },
  { key: 'thu', short: '목', long: '목요일' },
  { key: 'fri', short: '금', long: '금요일' },
  { key: 'sat', short: '토', long: '토요일' },
  { key: 'sun', short: '일', long: '일요일' }
];

const startOfCurrentWeek = (now = new Date()) => {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayDistance = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - mondayDistance);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

export const getWeekDays = (weekOffset: number, now = new Date()) => {
  const monday = startOfCurrentWeek(now);
  monday.setDate(monday.getDate() + weekOffset * 7);
  return weekDayMeta.map((item, index) => {
    const dateValue = new Date(monday);
    dateValue.setDate(monday.getDate() + index);
    return {
      ...item,
      date: String(dateValue.getDate()),
      month: dateValue.getMonth() + 1,
      dateValue
    };
  });
};

export const getToday = (now = new Date()) => {
  const index = (now.getDay() + 6) % 7;
  return { ...weekDayMeta[index], index, month: now.getMonth() + 1, date: now.getDate() };
};
