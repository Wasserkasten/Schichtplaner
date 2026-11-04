import { useEffect, useState, type ReactNode } from 'react';
import { get } from '../api';
import { reportError } from '../helpers';

/** Sehr kleiner Markdown-Renderer für CHANGELOG.md (Überschriften, Listen, Absätze, **fett**, `Code`, *kursiv*, [Links](…)). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!;
      out.push(/^https?:\/\//.test(href) ? <a key={k++} href={href} target="_blank" rel="noreferrer">{label}</a> : label);
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
    list = [];
    para = [];
  };
  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const text = h[2].replace(/^\[([^\]]+)\]/, '$1'); // "## [0.3.0] – Datum" -> "0.3.0 – Datum"
      if (level === 1) continue; // Titel der Datei
      blocks.push(level === 2 ? <h2 key={blocks.length}>{inline(text)}</h2> : <h3 key={blocks.length}>{inline(text)}</h3>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (para.length) flush();
      list.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (/^\s{2,}\S/.test(line) && list.length) {
      list[list.length - 1] += ' ' + line.trim(); // Fortsetzung eines Listenpunkts
    } else if (line.trim() === '') {
      flush();
    } else {
      if (list.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}

/** Verwaltung → Info: installierte Version und Änderungen je Version. */
export function InfoView() {
  const [data, setData] = useState<{ version: string; markdown: string } | null>(null);
  useEffect(() => {
    get<{ version: string; markdown: string }>('/api/admin/changelog').then((d) => {
      setData(d);
      try {
        localStorage.setItem('sp-seen-version', d.version);
      } catch {
        /* egal */
      }
      window.dispatchEvent(new CustomEvent('sp-version-seen', { detail: d.version })); // Update-Hinweis ausblenden
    }, reportError);
  }, []);
  if (!data) return <p className="muted">Lade …</p>;
  return (
    <div className="info">
      <div className="card narrow">
        <div className="muted small">Installierte Version</div>
        <div className="version">Schichtplaner {data.version}</div>
      </div>
      <div className="card changelog">
        {data.markdown ? <Markdown source={data.markdown} /> : <p className="muted">Kein Changelog vorhanden.</p>}
      </div>
    </div>
  );
}
