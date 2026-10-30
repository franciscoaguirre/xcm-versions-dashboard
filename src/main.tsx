import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GuidePage } from './components/GuidePage';
import { isGuideSlug } from './lib/guides';
import './index.css';

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
darkQuery.addEventListener('change', (event) => document.documentElement.classList.toggle('dark', event.matches));

const guide = new URLSearchParams(location.search).get('guide');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isGuideSlug(guide) ? <GuidePage slug={guide} /> : <App />}</StrictMode>,
);
