import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/base.css';

import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';

/*
 * 화면마다 스타일이 달라서(원래는 HTML 문서가 따로였다) 화면별로 나눠 불러온다.
 * 화면 사이 이동은 <a href> 로 새로 불러와 스타일이 섞이지 않게 한다.
 */
const PlayerPage = lazy(() => import('./pages/player/PlayerPage'));
const LoginPage = lazy(() => import('./pages/login/LoginPage'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
const HostPage = lazy(() => import('./pages/host/HostPage'));
const ScreenPage = lazy(() => import('./pages/screen/ScreenPage'));

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<PlayerPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/screen" element={<ScreenPage />} />
        <Route path="*" element={<PlayerPage />} />
      </Routes>
    </Suspense>
  </BrowserRouter>,
);
