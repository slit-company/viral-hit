import { changeInbox, collectInboxNow, inboxOverview, InboxRequestError } from '../src/core/references/instagram-inbox-application.server';
import { InstagramInboxStore } from '../src/core/references/instagram-inbox-store.server';

const usage = 'Usage: instagram-inbox status | configure ACCOUNT_ID PROJECT_ID on|off | check ACCOUNT_ID';
try {
  const [command, accountId, projectId, mode, ...extra] = process.argv.slice(2);
  let result: unknown;
  if (command === 'status' && !accountId) result = inboxOverview();
  else if (command === 'configure' && accountId && projectId && ['on', 'off'].includes(mode) && !extra.length) {
    const store = new InstagramInboxStore();
    let revision = 0;
    try { revision = store.settings(accountId)?.revision ?? 0; } finally { store.close(); }
    result = await changeInbox({ action: 'configure', accountId, projectId, enabled: mode === 'on', expectedRevision: revision });
  } else if (command === 'check' && accountId && !projectId) result = await collectInboxNow(accountId, AbortSignal.timeout(20 * 60_000));
  else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof InboxRequestError || (error instanceof Error && error.message === usage) ? error.message : 'Instagram inbox operation failed');
  process.exitCode = 1;
}
