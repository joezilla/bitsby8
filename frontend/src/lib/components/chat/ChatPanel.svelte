<script lang="ts">
  import Icon from '$lib/components/shared/Icon.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
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

  const exampleTools = [
    'get_status', 'list_drives', 'mount_disk', 'unmount_disk',
    'list_disk_images', 'create_disk_image', 'clone_disk_image',
    'list_cpm_files', 'read_cpm_file', 'write_cpm_file',
    'open_terminal', 'send_to_terminal', 'close_terminal',
    'start_replay', 'list_scripts', 'list_cassettes',
    'configure_serial', 'enable_disk_serving',
  ];

  const examplePrompts = [
    'Mount the CP/M boot disk on drive 0',
    'What files are on this disk?',
    'Transfer HELLO.BAS to the Altair via XMODEM',
    'Find a disk image with MBASIC on it',
    'Configure serial port to /dev/ttyUSB0 at 230400 baud',
    'Create a blank 8-inch disk image',
  ];

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
  <aside
    aria-label="AI assistant"
    style="
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 100%;
      max-width: 420px;
      z-index: 30;
      display: flex;
      flex-direction: column;
      background: var(--surface-raised);
      border-left: 1px solid var(--border-2);
      box-shadow: var(--elev-4);
    "
  >
    <!-- Header -->
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-1);
        flex: 0 0 auto;
      "
    >
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <LabelStrip>AI · Assistant · MCP</LabelStrip>
        <span style="font: var(--text-title-sm); color: var(--fg-1);">FDC+ Assistant</span>
      </div>
      <IconButton icon="close" size={18} title="Close" onclick={onclose} />
    </div>

    <!-- Content -->
    <div style="flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px;">
      <!-- MCP setup -->
      <Card>
        <div style="padding: 16px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <Icon name="extension" size={18} class="text-accent" />
            <span style="font: var(--text-title-sm); color: var(--fg-1);">MCP server integration</span>
          </div>
          <p style="font: var(--text-body-sm); color: var(--fg-2); margin: 0 0 12px;">
            Control your Altair 8800 with AI using the FDC+ MCP server. Add this
            configuration to Claude Desktop or Claude Code to get started.
          </p>

          <div style="position: relative;">
            <pre
              class="fdc-mono"
              style="
                background: var(--surface-sunken);
                border: 1px solid var(--border-1);
                border-radius: var(--radius-sm);
                padding: 12px;
                font-size: 11px;
                color: var(--info);
                overflow-x: auto;
                margin: 0;
              "
            >{mcpConfig}</pre>
            <span style="position: absolute; top: 6px; right: 6px;">
              <IconButton
                icon={copied ? 'check' : 'content_copy'}
                size={16}
                title="Copy configuration"
                onclick={copyConfig}
              />
            </span>
          </div>
        </div>
      </Card>

      <!-- Capabilities -->
      <Card>
        <div style="padding: 16px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <Icon name="auto_awesome" size={18} class="text-accent" />
            <span style="font: var(--text-title-sm); color: var(--fg-1);">What the AI can do</span>
          </div>
          <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px;">
            {#each examplePrompts as prompt}
              <li style="display: flex; gap: 8px; font: var(--text-body-sm); color: var(--fg-2);">
                <span style="color: var(--accent); flex: 0 0 auto;">›</span>
                <span style="font-style: italic;">"{prompt}"</span>
              </li>
            {/each}
          </ul>
        </div>
      </Card>

      <!-- Tools -->
      <Card>
        <div style="padding: 16px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
            <Icon name="build" size={18} class="text-accent" />
            <span style="font: var(--text-title-sm); color: var(--fg-1);">Available tools</span>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            {#each exampleTools as tool}
              <span
                class="fdc-mono"
                style="
                  padding: 2px 8px;
                  background: var(--surface-variant);
                  border: 1px solid var(--border-1);
                  border-radius: var(--radius-sm);
                  font-size: 10px;
                  color: var(--fg-2);
                "
              >
                {tool}
              </span>
            {/each}
            <span
              class="fdc-mono"
              style="
                padding: 2px 8px;
                background: var(--accent-bg);
                border-radius: var(--radius-sm);
                font-size: 10px;
                color: var(--accent);
              "
            >
              +11 more
            </span>
          </div>
        </div>
      </Card>

      <!-- Links -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <a
          href="https://claude.ai/download"
          target="_blank"
          rel="noopener noreferrer"
          style="
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font: var(--text-body-sm);
            color: var(--info);
            text-decoration: none;
          "
        >
          <Icon name="open_in_new" size={16} />
          Download Claude Desktop
        </a>
        <a
          href="https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview"
          target="_blank"
          rel="noopener noreferrer"
          style="
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font: var(--text-body-sm);
            color: var(--info);
            text-decoration: none;
          "
        >
          <Icon name="open_in_new" size={16} />
          Claude Code documentation
        </a>
      </div>
    </div>
  </aside>
{/if}
