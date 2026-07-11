/**
 * Smoke test: createMcpServer registers without throwing and the multi-client
 * parity tools are present. Tool behavior is covered by the shared-service
 * tests (client-service via routes-clients, multi-client-settings via
 * routes-settings, transient-service).
 */

import { createMcpServer } from '../src/mcp-server';

function fakeDeps(): any {
  return {
    config: { disksDir: '/tmp/disks' },
    database: {},
    driveManager: {},
    serialManager: { isOpen: () => false, getDevice: () => null, getBaudRate: () => 0 },
    terminalManager: {},
    multiClientServing: false,
    writeMaster: 'serial',
  };
}

describe('MCP multi-client tools', () => {
  test('createMcpServer registers all multi-client parity tools', () => {
    const server = createMcpServer(fakeDeps());
    const registered = (server as any)._registeredTools as Record<string, unknown>;
    const names = Object.keys(registered);

    for (const tool of [
      'get_multi_client_settings',
      'set_multi_client_settings',
      'list_clients',
      'set_client_name',
      'set_client_drive',
      'clear_client_drive',
      'forget_client',
      'commit_transient',
      'save_transient_snapshot',
      'commit_client_splinter',
      'save_client_splinter_snapshot',
      'save_client_splinter_as_disk',
    ]) {
      expect(names).toContain(tool);
    }

    // Sanity: the pre-existing snapshot/policy tools are still there too.
    expect(names).toContain('snapshot_disk_image');
    expect(names).toContain('set_disk_write_policy');
  });
});
