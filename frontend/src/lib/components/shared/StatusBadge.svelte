<script lang="ts" module>
  // ── The one vocabulary for entity/lifecycle state ──────────────────────────
  // Before this component, "dirty" was an amber dot on Machines, a cyan chip on
  // Clients, and prose in a Disks modal; "connected"/"read-only"/"transient" each
  // had their own ad-hoc treatment too. Every such state now resolves through this
  // single map, so the same concept reads identically on every page. Callers pass
  // a semantic `state`; colour + icon + wording live here, not at the call site.
  export type Status =
    | 'running'
    | 'stopped'
    | 'defined'
    | 'connected'
    | 'offline'
    | 'unsaved'
    | 'transient'
    | 'readonly'
    | 'master'
    | 'orphan'
    | 'headless'
    | 'machine';

  type ChipColor = 'amber' | 'green' | 'cyan' | 'red' | undefined;

  interface StatusSpec {
    color: ChipColor;
    icon?: string;
    label: string;
    title?: string;
  }

  // `color: undefined` renders the neutral Chip (surface-variant / fg-2).
  const STATUS: Record<Status, StatusSpec> = {
    running:   { color: 'green', icon: 'fiber_manual_record', label: 'running' },
    stopped:   { color: undefined, label: 'stopped' },
    defined:   { color: undefined, label: 'defined' },
    connected: { color: 'green', icon: 'bolt', label: 'connected' },
    offline:   { color: 'amber', label: 'offline' },
    // "unsaved" is the canonical copy-on-write "dirty" — an operator can still
    // lose these writes, so it reads as amber attention everywhere (drive
    // splinters, transient scratch, "this client has splinters").
    unsaved:   { color: 'amber', icon: 'bolt', label: 'unsaved', title: 'Unsaved copy-on-write changes — commit or save a snapshot to keep them' },
    transient: { color: 'cyan', icon: 'cached', label: 'transient', title: 'Copy-on-write mount — writes go to a throwaway scratch' },
    readonly:  { color: undefined, icon: 'lock', label: 'read-only' },
    master:    { color: 'green', icon: 'edit', label: 'master', title: 'Write master for multi-client disk serving' },
    orphan:    { color: 'red', icon: 'warning', label: 'orphan', title: 'The machine this client belonged to was deleted' },
    headless:  { color: undefined, icon: 'visibility_off', label: 'headless', title: 'Running with no console attached' },
    machine:   { color: 'cyan', icon: 'dns', label: 'machine', title: 'This client is a virtual machine instance' },
  };
</script>

<script lang="ts">
  import Chip from './Chip.svelte';

  interface Props {
    state: Status;
    /** Override the default wording (e.g. "splinters" for an `unsaved` client). */
    label?: string;
    /** Override the default tooltip. */
    title?: string;
    size?: 'md' | 'sm';
  }

  let { state, label, title, size = 'md' }: Props = $props();
  const spec = $derived(STATUS[state]);
</script>

<Chip color={spec.color} icon={spec.icon} {size} title={title ?? spec.title}>
  {label ?? spec.label}
</Chip>
