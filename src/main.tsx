import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ChainPage } from './components/ChainPage';
import { GuidePage } from './components/GuidePage';
import { isGuideSlug } from './lib/guides';
import './index.css';

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
darkQuery.addEventListener('change', (event) => document.documentElement.classList.toggle('dark', event.matches));

const params = new URLSearchParams(location.search);
const guide = params.get('guide');
const chain = params.get('chain');

const page = isGuideSlug(guide) ? <GuidePage slug={guide} /> : chain ? <ChainPage chainKey={chain} /> : <App />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{page}</StrictMode>,
);
