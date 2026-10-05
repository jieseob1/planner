// Keep the existing English visual kickers in Korean, but localize them in Spanish.
const spanishHeadings = {
  GOALS: 'METAS', REVIEW: 'REFLEXIÓN', TODO: 'TAREAS',
  'QUARTER OUTCOMES': 'RESULTADOS TRIMESTRALES', 'DECISION QUEUE': 'DECISIONES PENDIENTES',
  'SETTINGS & INTEGRATIONS': 'AJUSTES Y CONEXIONES', 'PLAN PREVIEW': 'VISTA PREVIA DEL PLAN',
  'METRIC UPDATE': 'ACTUALIZACIÓN DE INDICADORES', BLOCKER: 'OBSTÁCULO',
  'CARRYOVER DECISION': 'DECISIÓN DE APLAZAMIENTO', 'NEXT WEEK TOP 3': 'TOP 3 DE LA PRÓXIMA SEMANA',
  'CONFIRM PLAN': 'CONFIRMAR PLAN', 'PLAN LIBRARY': 'ARCHIVO DE PLANES', 'WELCOME BACK': 'BIENVENIDO DE NUEVO'
};
export const headingCatalog = (language: 'ko' | 'en' | 'es') => Object.fromEntries(
  Object.entries(spanishHeadings).map(([key, value]) => [key, language === 'es' ? value : key])
);
