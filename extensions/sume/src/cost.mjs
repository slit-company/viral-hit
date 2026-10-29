/** Retain only public billing amounts, never arbitrary provider metadata. Missing is not zero. */
export function reportedCost(data) {
  const summary = data?.job?.usage_summary;
  if (summary && ['reserved', 'captured', 'refunded'].includes(summary.status) && typeof summary.final === 'boolean') {
    const cost = { state: summary.status, final: summary.final, unit: 'credits' }, usdCents = {};
    for (const name of ['reserved', 'captured', 'refunded', 'released']) {
      const credits = summary[name + '_credits'], cents = summary[name + '_usd_cents'];
      if (Number.isSafeInteger(credits) && credits >= 0) cost[name] = credits;
      if (Number.isSafeInteger(cents) && cents >= 0) usdCents[name] = cents;
    }
    if (Object.keys(usdCents).length) cost.usdCents = usdCents;
    return cost;
  }
  if (Number.isSafeInteger(data?.usage?.credits) && data.usage.credits >= 0) {
    const cost = { state: 'reserved', final: false, unit: 'credits', reserved: data.usage.credits };
    if (typeof data.usage.usd === 'string' && /^\d+\.\d{2}$/.test(data.usage.usd)) { const cents = Math.round(Number(data.usage.usd) * 100); if (Number.isSafeInteger(cents)) cost.usdCents = { reserved: cents }; }
    return cost;
  }
  return { state: 'unknown', final: false };
}
