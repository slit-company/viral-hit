import type { Character, ProviderIdentity } from './contract';

/** An identity a model can use now: trained and finished, or pasted by hand (which has no status). */
export const identityReady = (identity: Pick<ProviderIdentity, 'status'>) => identity.status === undefined || identity.status === 'ready';

/** The library's identities a model setting accepts, named by their character, such as each character's Soul 2 ID. */
export function identitySuggestions(characters: readonly Pick<Character, 'name' | 'status' | 'providerIdentities'>[], wanted: { family: string; version?: string }) {
  return characters.filter(character => character.status === 'active').flatMap(character => character.providerIdentities
    .filter(identity => identity.provider === wanted.family && identityReady(identity) && (!wanted.version || !identity.version || identity.version === wanted.version))
    .map(identity => ({ value: identity.referenceId, label: character.name + (identity.label ? ' · ' + identity.label : '') })));
}
