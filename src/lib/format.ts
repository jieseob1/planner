import { tr } from '../i18n';
import type { Confidence, DayKey } from '../domain/types';

export const formatMinutes = (minutes: number) => {
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const rest = roundedMinutes % 60;
  if (hours === 0) return tr("{{v0}}분", { v0: rest });
  if (rest === 0) return tr("{{v0}}시간", { v0: hours });
  return tr("{{v0}}시간 {{v1}}분", { v0: hours, v1: rest });
};

export const formatClock = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};

export const formatTimer = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};

export const dayLabels = (): Record<DayKey, string> => ({
  mon: tr("월요일"),
  tue: tr("화요일"),
  wed: tr("수요일"),
  thu: tr("목요일"),
  fri: tr("금요일"),
  sat: tr("토요일"),
  sun: tr("일요일")
});

export const confidenceLabels = (): Record<Confidence, string> => ({
  high: tr("높음"),
  medium: tr("보통"),
  low: tr("낮음"),
  unknown: tr("미확인")
});
