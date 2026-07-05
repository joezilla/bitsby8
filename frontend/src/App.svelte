<script lang="ts">
  import Toast from '$lib/components/shared/Toast.svelte';
  import TopBar from '$lib/components/shell/TopBar.svelte';
  import Sidebar from '$lib/components/shell/Sidebar.svelte';
  import TerminalPage from '$lib/pages/TerminalPage.svelte';
  import DisksPage from '$lib/pages/DisksPage.svelte';
  import CassettesPage from '$lib/pages/CassettesPage.svelte';
  import ScriptsPage from '$lib/pages/ScriptsPage.svelte';
  import ConfigPage from '$lib/pages/ConfigPage.svelte';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';

  // Initialize socket connection (side effect on import)
  import '$lib/services/socket';
  // Initialize theme store (side effect: applies <html data-theme>)
  import '$lib/stores/theme';

  type PageId = 'terminal' | 'disks' | 'cassettes' | 'scripts' | 'config';

  const isNarrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

  let currentPage: PageId = $state('terminal');
  let sidebarOpen = $state(!isNarrow);
  let chatOpen = $state(false);

  function navigateTo(page: PageId): void {
    currentPage = page;
    if (isNarrow) sidebarOpen = false;
  }
</script>

<div
  class="fdc-root"
  style="
    width: 100%;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
  "
>
  <TopBar
    {chatOpen}
    {sidebarOpen}
    onToggleChat={() => (chatOpen = !chatOpen)}
    onToggleSidebar={() => (sidebarOpen = !sidebarOpen)}
  />

  <div style="flex: 1; display: flex; min-height: 0;">
    {#if sidebarOpen}
      <Sidebar active={currentPage} onNavigate={navigateTo} />
    {/if}

    <main
      id="main"
      aria-label="Main content"
      style="
        flex: 1;
        min-width: 0;
        overflow: auto;
        background: var(--bg);
        display: flex;
        flex-direction: column;
      "
    >
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

<ChatPanel open={chatOpen} onclose={() => (chatOpen = false)} />
<Toast />
