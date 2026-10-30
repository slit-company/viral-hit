import { ProviderConnections } from './provider-connections';
import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { RefreshCw, Puzzle } from 'lucide-react';
import { Action } from '@/components/base/action';
import { ProductShell } from '@/components/marketing/product-shell';
import type { ExtensionKind } from '@/core/extensions/contract';
import { useExtensionDiagnostics } from './use-extension-diagnostics';
import { Link } from '@/core/i18n/navigation';
import { ExtensionCard } from './extension-card';

const categories: { kind: ExtensionKind; title: string; description: string; empty: string }[] = [
  { kind: 'providers', get title() { return uiMessages["ui.extensions.models"](); }, get description() { return uiMessages["ui.extensions.image_and_video_models_installed_by_the_operator_built_in_model_services_ar"](); }, get empty() { return uiMessages["ui.extensions.no_extra_model_providers_add_a_provider_folder_on_the_server_then_restart_t"](); } },
  { kind: 'adapters', get title() { return uiMessages["ui.extensions.workflow_steps"](); }, get description() { return uiMessages["ui.extensions.additional_processing_and_generation_steps_available_to_the_execution_harne"](); }, get empty() { return uiMessages["ui.extensions.no_extra_workflow_adapters_add_a_checked_adapter_manifest_and_module_then_r"](); } },
  { kind: 'publishing', get title() { return uiMessages["ui.publishing.publishing"](); }, get description() { return uiMessages["ui.extensions.installed_destinations_for_delivering_finished_media_manage_built_in_social"](); }, get empty() { return uiMessages["ui.extensions.no_extra_publishing_connectors_add_a_connector_folder_on_the_server_then_re"](); } },
  { kind: 'skills', get title() { return uiMessages["ui.extensions.agent_skills"](); }, get description() { return uiMessages["ui.extensions.general_toolkits_and_instructions_for_specific_creative_jobs_compatibility_"](); }, get empty() { return uiMessages["ui.extensions.no_skills_could_be_loaded_check_the_server_skill_folders_and_refresh_this_p"](); } },
];

export function ExtensionsPage({ locale }: { locale: string }) {
  const status = useExtensionDiagnostics(), [selected, setSelected] = useState<ExtensionKind>('providers');
  const category = categories.find(item => item.kind === selected)!, group = status.data?.groups.find(item => item.kind === selected);
  return <ProductShell active="extensions" locale={locale}><main className="mx-auto w-full max-w-[1120px] space-y-8 px-5 pb-12 pt-14 sm:px-6">
    <header className="flex flex-wrap items-end justify-between gap-5"><div className="max-w-2xl space-y-4"><p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--vh-accent)]">{uiMessages["ui.extensions.extensions"]()}</p><h1 className="vh-product-display text-[clamp(2.25rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.04em]">{uiMessages["ui.extensions.know_what_s_connected"]()}</h1><p className="text-[15px] leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.extensions.inspect_the_models_workflow_steps_and_skills_added_to_your_studio_see_what_"]()}</p></div><Action className="vh-secondary" disabled={status.busy} onClick={() => void status.refresh()}><RefreshCw size={16} />{status.busy ? uiMessages["ui.extensions.loading_extension_metadata"]() : uiMessages["studio.controls.refresh_status"]()}</Action></header>
    <div className="flex flex-wrap gap-5 text-sm underline underline-offset-4"><Link href="/runtime-packages">{uiMessages["studio.controls.manage_runtime"]()}</Link><Link href="/community">{uiMessages["ui.community.browse_community_catalogs"]()}</Link></div>
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 text-sm leading-6 text-[var(--vh-text-2)]"><Puzzle size={18} className="mt-1 shrink-0 text-[var(--vh-text-1)]" /><p><strong className="font-semibold text-[var(--vh-text-1)]">{uiMessages["ui.extensions.execution_is_not_tested_here"]()}</strong> {uiMessages["ui.extensions.metadata_and_setting_presence_do_not_verify_credentials_or_output_quality_r"]()}</p></div>
    {status.data?.restartRequired && <p role="status" className="scroll-mt-24 rounded-xl bg-amber-100 p-4 text-sm leading-6 text-amber-950">{uiMessages["ui.extensions.managed_runtime_changes_are_pending_restart_studio_mcp_and_workers_together"]()}</p>}
    {status.error && <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-800">{status.error} {status.data && uiMessages["ui.extensions.showing_the_previous_check"]()}</p>}
    <ProviderConnections locale={locale} onChange={status.refresh} />
    <div role="group" aria-label={uiMessages["ui.extensions.extension_categories"]()} className="grid grid-cols-2 gap-3 sm:grid-cols-4">{categories.map(item => {
      const result = status.data?.groups.find(group => group.kind === item.kind), issues = result ? result.problems.length + result.items.filter(entry => entry.state === 'needs-setup').length : 0;
      return <Action key={item.kind} disabled={!status.data} aria-pressed={selected === item.kind} onClick={() => setSelected(item.kind)} className={'flex min-h-24 min-w-0 flex-col items-start gap-2 rounded-2xl border p-4 text-left ' + (selected === item.kind ? 'border-[var(--vh-text-1)] bg-[var(--vh-surface)]' : 'border-[var(--vh-border)] bg-transparent')}><span className="text-sm font-semibold">{item.title}</span><span className="text-xs text-[var(--vh-text-2)]">{result ? uiMessages["ui.extensions.group_count"]({ count: result.items.length, issues }) : uiMessages["ui.common.loading"]()}</span></Action>;
    })}</div>
    <section aria-label={uiMessages["ui.extensions.group_status"]({ name: category.title })} aria-busy={status.busy} className="space-y-5"><div className="space-y-2"><h2 className="text-xl font-semibold">{category.title}</h2><p className="text-sm leading-6 text-[var(--vh-text-2)]">{category.description}</p>{group && <p className="text-xs leading-5 text-[var(--vh-text-2)]">{group.refresh === 'restart' ? uiMessages["ui.extensions.after_changing_files_or_server_settings_restart_the_app_mcp_server_and_work"]() : selected === 'publishing' ? uiMessages["ui.extensions.metadata_is_read_again_on_refresh_changed_publishing_configuration_requires"]() : uiMessages["ui.extensions.skills_are_read_again_on_refresh_compatibility_is_checked_against_this_app_"]()}</p>}</div>
      {group?.sourceChanged && <p role="status" className="rounded-xl bg-amber-100 p-4 text-sm text-amber-950">{uiMessages["ui.extensions.provider_files_changed_restart_the_app_mcp_server_and_workers_to_load_the_c"]()}</p>}
      {!!group?.problems.length && <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-5"><h3 className="font-semibold text-amber-950">{uiMessages["ui.extensions.could_not_load"]()}</h3><ul className="space-y-2 text-sm text-amber-950">{group.problems.map(problem => <li key={problem.location} className="break-words"><strong>{problem.location}</strong> — {problem.message}</li>)}</ul></div>}
      {!group ? <p role="status" className="text-sm text-[var(--vh-text-2)]">{uiMessages["ui.extensions.loading_extension_metadata"]()}</p> : group.items.length ? <div className="grid items-start gap-4 md:grid-cols-2">{group.items.map(item => <ExtensionCard key={item.id} item={item} />)}</div> : <p className="rounded-2xl border border-dashed border-[var(--vh-border)] p-6 text-sm leading-6 text-[var(--vh-text-2)]">{category.empty}</p>}
    </section>
    {status.data && <p role="status" className="text-xs text-[var(--vh-text-2)]">{uiMessages["ui.extensions.last_checked"]()} {new Date(status.data.checkedAt).toLocaleTimeString(locale)}</p>}
  </main></ProductShell>;
}
