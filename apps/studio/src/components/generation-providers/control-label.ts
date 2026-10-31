import { m as uiMessages } from '@/paraglide/messages.js';

type MessageFn = () => string;
const messages = uiMessages as unknown as Record<string, MessageFn | undefined>;
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const lookup = (prefix: string, label: string) => {
  const message = messages[`${prefix}.${slug(label)}`];
  return typeof message === 'function' ? message() : label;
};

/** Provider catalogs declare English labels; show the reader's language when a translation exists. */
export const localizeControlLabel = (label: string) => lookup('studio.control_label', label);
export const localizeChoiceLabel = (label: string) => lookup('studio.control_choice', label);
