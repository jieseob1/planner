import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { PlannerScreen } from './screens/PlannerScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { TodayScreen } from './screens/TodayScreen';
import { PlansScreen } from './screens/PlansScreen';
import { PlannerProvider } from './state/PlannerProvider';
import { AuthProvider } from './auth/AuthProvider';
import { SettingsScreen } from './screens/SettingsScreen';
import { PrivacyScreen, TermsScreen } from './screens/LegalScreen';
import { LandingScreen } from './screens/LandingScreen';
import { usePlanner } from './state/PlannerProvider';
import { TimeZoneProvider } from './timezone/TimeZoneProvider';
import { AdminScreen } from './admin/AdminScreen';
import { Capacitor } from '@capacitor/core';
import { PeriodProvider } from './state/PeriodProvider';
import { PeriodGoalsScreen } from './screens/PeriodGoalsScreen';
import { PeriodReviewScreen } from './screens/PeriodReviewScreen';
import './styles/periods.css';

function RequireActivePlan({ children }: { children: ReactNode }) {
  const { hasActivePlan, plannerReady } = usePlanner();
  if (!plannerReady) return <main className="route-loading" role="status">계획을 불러오고 있습니다…</main>;
  return hasActivePlan ? children : <Navigate to="/onboarding" replace />;
}

function RequireNoActivePlan({ children }: { children: ReactNode }) {
  const { hasActivePlan, plannerReady } = usePlanner();
  if (!plannerReady) return <main className="route-loading" role="status">계획을 불러오고 있습니다…</main>;
  return hasActivePlan ? <Navigate to="/today" replace /> : children;
}

function GoalsRoute() {
  const [params] = useSearchParams();
  return params.get('action') === 'stop' ? <Navigate to={`/goals/legacy?${params}`} replace /> : <PeriodGoalsScreen />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<RequireNoActivePlan><OnboardingScreen /></RequireNoActivePlan>} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<RequireActivePlan><TodayScreen /></RequireActivePlan>} />
        <Route path="/planner" element={<RequireActivePlan><PlannerScreen /></RequireActivePlan>} />
        <Route path="/goals" element={<GoalsRoute />} />
        <Route path="/review" element={<PeriodReviewScreen />} />
        <Route path="/goals/legacy" element={<RequireActivePlan><GoalsScreen /></RequireActivePlan>} />
        <Route path="/review/legacy" element={<RequireActivePlan><ReviewScreen /></RequireActivePlan>} />
        <Route path="/plans" element={<PlansScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/admin" element={<AdminScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={Capacitor.isNativePlatform() ? <Navigate to="/today" replace /> : <LandingScreen />} />
        <Route path="/privacy" element={<PrivacyScreen />} />
        <Route path="/terms" element={<TermsScreen />} />
        <Route path="/*" element={(
          <AuthProvider>
            <TimeZoneProvider>
              <PlannerProvider>
                <PeriodProvider><AppRoutes /></PeriodProvider>
              </PlannerProvider>
            </TimeZoneProvider>
          </AuthProvider>
        )} />
      </Routes>
    </BrowserRouter>
  );
}
