#!/usr/bin/env node
/**
 * Debug Serial Server - Simplified version for troubleshooting
 * This script helps diagnose serial communication issues
 */

import { SerialPort } from 'serialport';

const port = process.argv[2] || '/dev/cu.usbserial-FTE90ZVP';
const baudRate = parseInt(process.argv[3]) || 460800;

console.log('=== FDC+ Serial Debug Tool ===');
console.log(`Port: ${port}`);
console.log(`Baud Rate: ${baudRate}`);
console.log('Waiting for commands from FDC+...\n');

let serialPort: SerialPort;

async function main() {
  try {
    // Open serial port with same settings as C version
    serialPort = new SerialPort({
      path: port,
      baudRate: baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      // Critical: Disable ALL flow control to match C version
      rtscts: false,         // No RTS/CTS hardware flow control
      xon: false,            // No XON/XOFF software flow control
      xoff: false,
      xany: false,
      lock: false,
    });

    serialPort.on('open', () => {
      console.log('✅ Serial port opened successfully');
    });

    serialPort.on('error', (err) => {
      console.error('❌ Serial port error:', err.message);
      process.exit(1);
    });

    serialPort.on('close', () => {
      console.log('Serial port closed');
    });

    // Listen for raw data
    serialPort.on('data', (data: Buffer) => {
      console.log(`\n📨 Received ${data.length} bytes:`);
      console.log('  Hex:', data.toString('hex'));
      console.log('  ASCII:', data.toString('ascii').replace(/[^\x20-\x7E]/g, '.'));

      // Try to parse as FDC+ command
      if (data.length >= 8) {
        const cmd = data.toString('ascii', 0, 4);
        const param1 = data.readUInt16LE(4);
        const param2 = data.readUInt16LE(6);

        console.log(`  Command: "${cmd}"`);
        console.log(`  Param1: 0x${param1.toString(16).padStart(4, '0')}`);
        console.log(`  Param2: 0x${param2.toString(16).padStart(4, '0')}`);

        // Send a dummy response for STAT
        if (cmd === 'STAT') {
          const response = Buffer.alloc(10);
          response.write('STAT', 0, 4, 'ascii');
          response.writeUInt16LE(param1, 4);
          response.writeUInt16LE(0x0000, 6); // No drives mounted

          // Calculate checksum
          let checksum = 0;
          for (let i = 0; i < 8; i++) {
            checksum += response[i];
          }
          response.writeUInt16LE(checksum & 0xffff, 8);

          console.log('\n📤 Sending STAT response...');
          serialPort.write(response, (err) => {
            if (err) {
              console.error('  ❌ Write error:', err.message);
            } else {
              console.log('  ✅ Response sent');
            }
          });
        }
      }
    });

    // Keep running
    console.log('\nPress Ctrl+C to exit...\n');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (serialPort && serialPort.isOpen) {
    serialPort.close();
  }
  process.exit(0);
});

main();
