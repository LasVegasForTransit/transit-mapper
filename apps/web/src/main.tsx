import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './app/app-root';
import { BOOTSTRAP_START_MARK, markOnce } from './perf/startup-marks';
import { startFieldSampling } from './perf/field-sampling';
import { performanceSurfaceForPath } from './perf/field-sampling-policy';
import './theme/font.css';

markOnce(BOOTSTRAP_START_MARK);
startFieldSampling(performanceSurfaceForPath(window.location.pathname));

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Editor root element is missing');
createRoot(rootElement).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
