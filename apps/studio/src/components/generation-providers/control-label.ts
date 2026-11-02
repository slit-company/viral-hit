import { CONTROL_CHOICES, CONTROL_LABELS } from './control-label-messages';

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const lookup = (table: Readonly<Record<string, () => string>>, label: string) => {
  const key = slug(label);
  return Object.hasOwn(table, key) ? table[key]() : label;
};

/** Provider catalogs declare English labels; show the reader's language when a translation exists. */
export const localizeControlLabel = (label: string) => lookup(CONTROL_LABELS, label);
export const localizeChoiceLabel = (label: string) => lookup(CONTROL_CHOICES, label);
