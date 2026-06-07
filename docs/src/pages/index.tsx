import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={styles.hero}>
      <div className="container">
        <div className={styles.heroLogo}>
          <svg width="80" height="80" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="512" height="512" rx="112" fill="#1a1e2e"/>
            <circle cx="228" cy="218" r="128" stroke="url(#lens)" strokeWidth="28"/>
            <circle cx="228" cy="218" r="112" fill="rgba(74,123,247,0.08)"/>
            <line x1="168" y1="190" x2="288" y2="190" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.7"/>
            <line x1="168" y1="218" x2="260" y2="218" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
            <line x1="168" y1="246" x2="240" y2="246" stroke="#6ea8fe" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
            <line x1="324" y1="316" x2="408" y2="400" stroke="url(#handle)" strokeWidth="32" strokeLinecap="round"/>
            <defs>
              <linearGradient id="lens" x1="140" y1="90" x2="316" y2="346">
                <stop stopColor="#6ea8fe"/>
                <stop offset="1" stopColor="#4a7bf7"/>
              </linearGradient>
              <linearGradient id="handle" x1="324" y1="316" x2="408" y2="400">
                <stop stopColor="#8b95a5"/>
                <stop offset="1" stopColor="#5a6370"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h1 className={styles.heroTitle}>PromptLens</h1>
        <p className={styles.heroSubtitle}>Local-first LLM log viewer & analyzer</p>
        <p className={styles.heroDescription}>
          View, search, and analyze JSONL audit logs from OpenAI, Anthropic, Gemini, Ollama,
          and agent sessions — all on your machine. No network. No telemetry.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/getting-started">
            Get Started
          </Link>
          <Link className="button button--secondary button--lg" to="/architecture">
            Architecture
          </Link>
        </div>
      </div>
    </header>
  );
}

function Features() {
  const items = [
    { title: 'Multi-Provider', desc: 'Normalize logs from OpenAI, Anthropic, Gemini, Ollama into a unified view.' },
    { title: 'Agent Sessions', desc: 'Support for Claude Code, Codex, OpenCode, and OpenClaw session formats.' },
    { title: 'Lightning Fast', desc: 'Byte-offset indexing for O(1) record access. SQLite cache for instant re-opens.' },
    { title: 'Full-Text Search', desc: 'FTS5-powered search across all records with substring and regex modes.' },
    { title: 'Cost Analysis', desc: 'Built-in pricing for 18 models. Track token usage and estimate costs.' },
    { title: 'Local-First', desc: 'Zero network calls. Zero telemetry. Your data never leaves your machine.' },
  ];
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {items.map((item, i) => (
            <div key={i} className="col col--4">
              <div className={styles.featureCard}>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout title="Home" description="Local-first LLM log viewer & analyzer">
      <HomepageHeader />
      <Features />
    </Layout>
  );
}
