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

  let currentPage: PageId = $state('terminal');
  let mobileMenuOpen = $state(false);
  let chatOpen = $state(false);

  function navigateTo(page: PageId): void {
    currentPage = page;
    mobileMenuOpen = false;
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
    {mobileMenuOpen}
    onToggleChat={() => (chatOpen = !chatOpen)}
    onToggleMobileMenu={() => (mobileMenuOpen = !mobileMenuOpen)}
  />

  <div style="flex: 1; display: flex; min-height: 0;">
    <!-- Desktop sidebar (lg+) -->
    <div class="hidden lg:flex">
      <Sidebar active={currentPage} onNavigate={navigateTo} />
    </div>

    <!-- Mobile sidebar drawer -->
    {#if mobileMenuOpen}
      <div class="lg:hidden" style="position: fixed; inset: 0; z-index: 40;">
        <button
          type="button"
          aria-label="Close menu"
          onclick={() => (mobileMenuOpen = false)}
          style="position: absolute; inset: 0; background: var(--surface-overlay); border: none; cursor: default;"
        ></button>
        <div style="position: absolute; left: 0; top: 56px; bottom: 0; z-index: 50;">
          <Sidebar active={currentPage} onNavigate={navigateTo} />
        </div>
      </div>
    {/if}

    <main
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
