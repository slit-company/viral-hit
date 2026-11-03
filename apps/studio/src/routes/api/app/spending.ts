import { createFileRoute } from '@tanstack/react-router';
import { readSpending, SPENDING_PERIODS } from '@/core/costs/spending.server';

async function GET({ request }: { request: Request }) {
  const days = Number(new URL(request.url).searchParams.get('days') ?? 30);
  if (!SPENDING_PERIODS.includes(days as never)) return Response.json({ error: 'Choose 7, 30 or 90 days' }, { status: 400 });
  return Response.json(await readSpending({ days }), { headers: { 'Cache-Control': 'no-store' } });
}
export const Route = createFileRoute('/api/app/spending')({ server: { handlers: { GET } } });
