import type { Entry, EntryType } from '../types';
import { entryLabel, entryTitle } from '../helpers';

export function EntryChip({ e, types, long }: { e: Entry; types: Map<number, EntryType>; long?: boolean }) {
  const t = e.typeId ? types.get(e.typeId) : undefined;
  const style = t ? { background: t.color, color: t.textColor } : undefined;
  const cls = t ? 'chip' : e.masked ? 'chip masked' : 'chip note';
  if (e.masked) {
    return <span className={cls} title="abwesend">{long ? 'abwesend' : 'abw'}</span>;
  }
  return (
    <span className={cls} style={style} title={entryTitle(e, types)}>
      {long ? (t ? `${t.code} · ${t.name}${e.text ? ` – ${e.text}` : ''}` : e.text) : entryLabel(e, types)}
    </span>
  );
}
