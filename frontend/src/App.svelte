<script lang="ts">
  import LedPanel from '$lib/components/shared/LedPanel.svelte';
  import Toast from '$lib/components/shared/Toast.svelte';
  import TerminalPage from '$lib/pages/TerminalPage.svelte';
  import DisksPage from '$lib/pages/DisksPage.svelte';
  import CassettesPage from '$lib/pages/CassettesPage.svelte';
  import ScriptsPage from '$lib/pages/ScriptsPage.svelte';
  import ConfigPage from '$lib/pages/ConfigPage.svelte';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import { Monitor, HardDrive, Disc3, FileText, Settings, Menu, X, MessageSquare } from 'lucide-svelte';

  // Initialize socket connection (side effect on import)
  import '$lib/services/socket';

  let currentPage = $state('terminal');
  let mobileMenuOpen = $state(false);
  let chatOpen = $state(false);

  const pages = [
    { id: 'terminal', label: 'Terminal', icon: Monitor },
    { id: 'disks', label: 'Disks', icon: HardDrive },
    { id: 'cassettes', label: 'Cassettes', icon: Disc3 },
    { id: 'scripts', label: 'Scripts', icon: FileText },
    { id: 'config', label: 'Config', icon: Settings },
  ] as const;

  function navigateTo(page: string) {
    currentPage = page;
    mobileMenuOpen = false;
  }
</script>

<div class="min-h-screen flex flex-col bg-panel-sunken">
  <!-- Header -->
  <header class="bg-panel border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
    <div class="flex items-center gap-3">
      <!-- Mobile menu button -->
      <button
        class="lg:hidden text-text-dim hover:text-text"
        onclick={() => mobileMenuOpen = !mobileMenuOpen}
      >
        {#if mobileMenuOpen}
          <X size={20} />
        {:else}
          <Menu size={20} />
        {/if}
      </button>
      <h1 class="text-amber font-retro text-2xl tracking-wider">FDC+</h1>
      <span class="text-text-dim text-xs hidden sm:inline">Serial Drive Server</span>
    </div>
    <div class="flex items-center gap-3">
      <LedPanel />
      <button
        class="p-1.5 rounded transition-colors {chatOpen ? 'text-amber bg-amber/10' : 'text-text-dim hover:text-text'}"
        onclick={() => chatOpen = !chatOpen}
        title="AI Assistant"
      >
        <MessageSquare size={18} />
      </button>
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar nav (desktop) -->
    <nav class="hidden lg:flex flex-col w-48 bg-panel border-r border-border shrink-0">
      {#each pages as page}
        <button
          class="flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left
            {currentPage === page.id
              ? 'text-amber bg-surface border-r-2 border-amber'
              : 'text-text-dim hover:text-text hover:bg-surface-hover'}"
          onclick={() => navigateTo(page.id)}
        >
          <page.icon size={16} />
          {page.label}
        </button>
      {/each}
    </nav>

    <!-- Mobile nav overlay -->
    {#if mobileMenuOpen}
      <div class="fixed inset-0 z-40 lg:hidden">
        <button class="absolute inset-0 bg-black/60 cursor-default" onclick={() => mobileMenuOpen = false} aria-label="Close menu"></button>
        <nav class="absolute left-0 top-0 bottom-0 w-64 bg-panel border-r border-border pt-14 z-50">
          {#each pages as page}
            <button
              class="flex items-center gap-3 px-4 py-3 text-sm w-full transition-colors text-left
                {currentPage === page.id
                  ? 'text-amber bg-surface'
                  : 'text-text-dim hover:text-text hover:bg-surface-hover'}"
              onclick={() => navigateTo(page.id)}
            >
              <page.icon size={16} />
              {page.label}
            </button>
          {/each}
        </nav>
      </div>
    {/if}

    <!-- Page content -->
    <main class="flex-1 overflow-auto p-4 lg:p-6">
      {#if currentPage === 'terminal'}
        <TerminalPage />
      {:else if currentPage === 'disks'}
        <DisksPage />
      {:else if currentPage === 'cassettes'}
        <CassettesPage />
      {:else if currentPage === 'scripts'}
        <ScriptsPage />
      {:else if currentPage === 'config'}
        <ConfigPage />
      {/if}
    </main>
  </div>
</div>

<ChatPanel open={chatOpen} onclose={() => chatOpen = false} />
<Toast />
