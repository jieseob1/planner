import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { PlannerScreen } from './screens/PlannerScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { TodayScreen } from './screens/TodayScreen';
import { PlannerProvider } from './state/PlannerProvider';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="/today" element={<TodayScreen />} />
        <Route path="/planner" element={<PlannerScreen />} />
        <Route path="/goals" element={<GoalsScreen />} />
        <Route path="/review" element={<ReviewScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <PlannerProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </PlannerProvider>
  );
}
