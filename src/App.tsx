import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<RequireNoActivePlan><OnboardingScreen /></RequireNoActivePlan>} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<RequireActivePlan><TodayScreen /></RequireActivePlan>} />
        <Route path="/planner" element={<RequireActivePlan><PlannerScreen /></RequireActivePlan>} />
        <Route path="/goals" element={<RequireActivePlan><GoalsScreen /></RequireActivePlan>} />
        <Route path="/review" element={<RequireActivePlan><ReviewScreen /></RequireActivePlan>} />
        <Route path="/plans" element={<PlansScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingScreen />} />
        <Route path="/privacy" element={<PrivacyScreen />} />
        <Route path="/terms" element={<TermsScreen />} />
        <Route path="/*" element={(
          <AuthProvider>
            <PlannerProvider>
              <AppRoutes />
            </PlannerProvider>
          </AuthProvider>
        )} />
      </Routes>
    </BrowserRouter>
  );
}
