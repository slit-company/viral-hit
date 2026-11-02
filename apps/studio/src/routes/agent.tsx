import { createFileRoute } from '@tanstack/react-router';
import { AgentPage } from '@/components/agent/agent-page';

export const Route = createFileRoute('/agent')({ component: AgentPage });
