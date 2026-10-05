'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import AudioToggle from './AudioToggle';
import styles from './showcase.module.css';

const ExperienceCanvas = dynamic(() => import('./ExperienceCanvas'), { ssr: false });

const chapters = [
  { id: 'form', label: 'FORM', title: '' },
  { id: 'melt', label: 'MELT', title: 'Nothing stays solid.' },
  { id: 'fracture', label: 'FRACTURE', title: 'Order comes apart.' },
  { id: 'echo', label: 'ECHO', title: 'Everything returns.' },
] as const;

type BoundaryProps = { children: ReactNode; fallback: ReactNode; onFailure: () => void };
type BoundaryState = { failed: boolean };

class CanvasErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onFailure();
    if (process.env.NODE_ENV === 'development') {
      console.error('[AFTERFORM renderer]', error);
    }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function Showcase() {
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [canvasStatus, setCanvasStatus] = useState<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  const [activeChapter, setActiveChapter] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const sectionRefs = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const prefersReducedMotion = preference.matches;
      setReducedMotion(prefersReducedMotion);
      setCanvasStatus(prefersReducedMotion ? 'waiting' : 'loading');
    };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const sections = sectionRefs.current.filter(Boolean);
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => ratios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0));
      let current: Element | null = null;
      let highestRatio = 0;
      ratios.forEach((ratio, section) => {
        if (ratio > highestRatio) {
          current = section;
          highestRatio = ratio;
        }
      });
      if (!current) return;
      const index = chapters.findIndex(({ id }) => id === (current as HTMLElement).id);
      if (index >= 0) setActiveChapter(index);
    }, { threshold: [0.1, 0.25, 0.45, 0.65], rootMargin: '-12% 0px -12% 0px' });

    sections.forEach((section) => observer.observe(section));
    return () => {
      observer.disconnect();
      ratios.clear();
    };
  }, []);

  const onReady = useCallback(() => setCanvasStatus('ready'), []);
  const onFailure = useCallback(() => setCanvasStatus('error'), []);
  const retry = useCallback(() => {
    setCanvasStatus('loading');
    setRetryKey((key) => key + 1);
  }, []);

  const showStatic = canvasStatus !== 'ready';
  const failureNotice = (
    <div className={styles.failureNotice} role="status">
      <span>实时画面暂不可用</span>
      <button className={styles.retryButton} onClick={retry} type="button">重试</button>
    </div>
  );

  return (
    <main className={styles.showcase}>
      {reducedMotion !== true && (
        <div
          aria-hidden="true"
          className={`${styles.staticScene} ${showStatic ? styles.staticSceneVisible : ''}`}
          data-frame={(chapters[activeChapter] ?? chapters[0]).id}
        />
      )}

      {reducedMotion === false && canvasStatus !== 'error' && (
        <CanvasErrorBoundary key={retryKey} fallback={failureNotice} onFailure={onFailure}>
          <div aria-hidden="true" className={`${styles.canvasLayer} ${canvasStatus === 'ready' ? styles.canvasReady : ''}`}>
            <ExperienceCanvas onReady={onReady} onFailure={onFailure} reducedMotion={false} />
          </div>
        </CanvasErrorBoundary>
      )}

      {canvasStatus === 'error' && failureNotice}

      <header className={styles.header}>
        <a className={styles.logo} href="#form" aria-label="AFTERFORM 首页">AFTERFORM</a>
        <nav className={styles.navigation} aria-label="章节导航">
          {chapters.map(({ id, label }, index) => (
            <a
              aria-current={activeChapter === index ? 'location' : undefined}
              className={styles.navLink}
              href={`#${id}`}
              key={id}
              onClick={() => setActiveChapter(index)}
            >
              {label}
            </a>
          ))}
        </nav>
        <AudioToggle />
      </header>

      <div className={styles.chapters}>
        {chapters.map(({ id, title }, index) => (
          <section
            aria-labelledby={`${id}-title`}
            className={`${styles.chapter} ${index === 0 ? styles.firstChapter : ''}`}
            id={id}
            key={id}
            ref={(node) => { if (node) sectionRefs.current[index] = node; }}
          >
            {reducedMotion === true && (
              <div
                aria-hidden="true"
                className={styles.chapterFrame}
                data-frame={id}
              />
            )}
            <div className={styles.copy}>
              {index === 0 ? (
                <>
                  <h1 className={styles.heroTitle} id="form-title">
                    <span>AFTER</span>
                    <span>FORM</span>
                  </h1>
                  <p className={styles.heroChinese}>形态，正在发生。</p>
                  <p className={styles.heroEnglish}>An exploration of matter.</p>
                </>
              ) : (
                <h2 className={styles.chapterTitle} id={`${id}-title`}>{title}</h2>
              )}
              {index === 3 && (
                <a className={styles.replayButton} href="#form">重新观看</a>
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
