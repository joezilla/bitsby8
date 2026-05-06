<script lang="ts">
  import { MessageSquare, X, ExternalLink, Copy, Check } from 'lucide-svelte';
  import { showToast } from '$lib/stores/toast';

  interface Props {
    open?: boolean;
    onclose?: () => void;
  }

  let { open = false, onclose }: Props = $props();
  let copied = $state(false);

  const mcpConfig = JSON.stringify({
    mcpServers: {
      fdcplus: {
        command: 'fdcsds',
        args: ['--mcp', '--data-dir', '/path/to/your/data'],
      },
    },
  }, null, 2);

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(mcpConfig);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      showToast('Failed to copy', 'error');
    }
  }
</script>

{#if open}
  <div class="fixed right-0 top-0 bottom-0 w-full max-w-md z-30 flex flex-col bg-panel border-l border-border shadow-2xl shadow-black/40">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <div class="flex items-center gap-2">
        <MessageSquare size={16} class="text-amber" />
        <span class="text-sm font-retro text-amber tracking-wider">AI Assistant</span>
      </div>
      <button
        class="p-1 text-text-dim hover:text-text transition-colors"
        onclick={onclose}
      >
        <X size={16} />
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4 flex flex-col gap-4">
      <!-- MCP Setup Instructions -->
      <div class="bg-panel-sunken rounded-lg border border-border p-4">
        <h3 class="text-sm font-semibold text-text mb-2">MCP Server Integration</h3>
        <p class="text-xs text-text-dim leading-relaxed mb-3">
          Control your Altair 8800 with AI using the FDC+ MCP server.
          Add this configuration to Claude Desktop or Claude Code to get started.
        </p>

        <!-- Config block -->
        <div class="relative">
          <pre class="bg-[#0a0a0a] rounded border border-border p-3 text-xs text-cyan overflow-x-auto font-mono">{mcpConfig}</pre>
          <button
            class="absolute top-2 right-2 p-1.5 rounded bg-panel border border-border text-text-dim hover:text-text transition-colors"
            onclick={copyConfig}
            title="Copy configuration"
          >
            {#if copied}
              <Check size={12} class="text-green" />
            {:else}
              <Copy size={12} />
            {/if}
          </button>
        </div>
      </div>

      <!-- Capabilities -->
      <div class="bg-panel-sunken rounded-lg border border-border p-4">
        <h3 class="text-sm font-semibold text-text mb-2">What the AI can do</h3>
        <ul class="text-xs text-text-dim space-y-1.5">
          <li class="flex items-start gap-2">
            <span class="text-amber mt-0.5">&#x2022;</span>
            <span>"Mount the CP/M boot disk on drive 0"</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-amber mt-0.5">&#x2022;</span>
            <span>"What files are on this disk?"</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-amber mt-0.5">&#x2022;</span>
            <span>"Transfer HELLO.BAS to the Altair via XMODEM"</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-amber mt-0.5">&#x2022;</span>
            <span>"Find a disk image with MBASIC on it"</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-amber mt-0.5">&#x2022;</span>
            <span>"Configure serial port to /dev/ttyUSB0 at 230400 baud"</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-amber mt-0.5">&#x2022;</span>
            <span>"Create a blank 8-inch disk image"</span>
          </li>
        </ul>
      </div>

      <!-- 29 tools badge -->
      <div class="bg-panel-sunken rounded-lg border border-border p-4">
        <h3 class="text-sm font-semibold text-text mb-2">Available Tools</h3>
        <div class="flex flex-wrap gap-1.5">
          {#each [
            'get_status', 'list_drives', 'mount_disk', 'unmount_disk',
            'list_disk_images', 'create_disk_image', 'clone_disk_image',
            'list_cpm_files', 'read_cpm_file', 'write_cpm_file',
            'open_terminal', 'send_to_terminal', 'close_terminal',
            'start_replay', 'list_scripts', 'list_cassettes',
            'configure_serial', 'enable_disk_serving',
          ] as tool}
            <span class="px-2 py-0.5 bg-surface rounded text-[10px] text-text-dim font-mono">{tool}</span>
          {/each}
          <span class="px-2 py-0.5 bg-amber/10 rounded text-[10px] text-amber font-mono">+11 more</span>
        </div>
      </div>

      <!-- Links -->
      <div class="flex flex-col gap-2">
        <a
          href="https://claude.ai/download"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-2 text-xs text-cyan hover:text-cyan-bright transition-colors"
        >
          <ExternalLink size={12} />
          Download Claude Desktop
        </a>
        <a
          href="https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-2 text-xs text-cyan hover:text-cyan-bright transition-colors"
        >
          <ExternalLink size={12} />
          Claude Code Documentation
        </a>
      </div>
    </div>
  </div>
{/if}
